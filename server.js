// File: server.js | System: Bright & Bold Monitoring Backend (PostgreSQL Version)
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const { handleSilentSync, handleSessionExit, handleSessionLogin, ensureDatabaseSchema, startTtlCleanupJob } = require('./sessionManager');
const { sendWhatsAppNotification } = require('./whatsappService');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
    console.error("FATAL ERROR: JWT_SECRET environment variable is missing in production.");
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET || 'mrelorm_super_secure_jwt_secret_key_2026';

app.set('trust proxy', true);

const allowedOrigins = [
    'https://elormacademy.com',
    'https://www.elormacademy.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5500',
    'http://localhost:5500'
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
            callback(null, true);
        } else {
            callback(new Error('Blocked by CORS policy: Unauthorized origin.'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));

app.use(express.json());
app.use(express.text({ type: ['text/plain', 'application/text'] }));

// Strict Format Validation Helpers
function isValidSchoolCodeFormat(code) {
    if (!code) return false;
    const clean = code.trim().toUpperCase();
    if (clean === 'ONLINE-DIRECT' || clean === 'CEO-HQ') return true;
    const schoolCodeRegex = /^[A-Z]{3}-[A-Z0-9]{7}$/;
    return schoolCodeRegex.test(clean);
}

function isValidProductCodeFormat(code) {
    if (!code) return false;
    const clean = code.trim().toUpperCase();
    if (clean.startsWith('ELORM_')) return true;
    const productCodeRegex = /^[A-Z0-9]{3,4}-[A-Z0-9]{3,4}-[A-Z0-9]{3,4}-[A-Z0-9]{3,4}$/;
    return productCodeRegex.test(clean);
}

function normalizePhoneNumber(raw) {
    if (!raw) return '';
    let clean = raw.toString().replace(/[^0-9]/g, '');
    if (clean.startsWith('0') && clean.length === 10) {
        clean = '233' + clean.slice(1);
    }
    return clean;
}

function addDurationToDate(baseDate, productTypeOrPlan) {
    const d = new Date(baseDate);
    const p = (productTypeOrPlan || '').toLowerCase();
    if (p.includes('6month') || p.includes('half')) {
        d.setMonth(d.getMonth() + 6);
    } else if (p.includes('year')) {
        d.setFullYear(d.getFullYear() + 1);
    } else {
        d.setMonth(d.getMonth() + 1);
    }
    return d.toISOString().split('T')[0];
}

// Health check endpoint for Railway and external services
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        system: 'Bright & Bold Monitor Backend API',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'schoolmonitor-backend' });
});

// Initialize DB schema & start the 15-minute background inactivity watchdog
ensureDatabaseSchema();
startTtlCleanupJob();

function isDeveloperIp(ip) {
    if (process.env.NODE_ENV !== 'production') return true;
    if (!ip) return false;
    
    const localIps = ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'];
    if (localIps.includes(ip)) return true;
    
    if (ip.startsWith('192.168.') || ip.startsWith('::ffff:192.168.')) return true;
    if (ip.startsWith('10.') || ip.startsWith('::ffff:10.')) return true;
    if (ip.startsWith('172.') || ip.startsWith('::ffff:172.')) return true;

    return false;
}

function normalizeClientIp(rawIp) {
    if (!rawIp) return '127.0.0.1 (Localhost)';
    let clean = rawIp.replace(/^::ffff:/, '');
    if (clean === '::1' || clean === '127.0.0.1' || clean === 'localhost') {
        return '127.0.0.1 (Localhost)';
    }
    return clean;
}

// Security Middleware to block unauthenticated API requests
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access Denied: No authentication token provided.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Access Denied: Invalid or expired cryptographic signature.' });
        }
        req.user = user;
        next();
    });
}

function resolveActorFromReq(req, fallbackActor = 'System') {
    if (req.user) {
        if (req.user.role === 'CEO') return 'CEO Master';
        if (req.user.schoolName) return `${req.user.schoolName} (${req.user.schoolCode || 'School'})`;
        if (req.user.studentName) return `${req.user.studentName} (Student)`;
    }
    
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded.role === 'CEO') return 'CEO Master';
            if (decoded.schoolName) return `${decoded.schoolName} (${decoded.schoolCode || 'School'})`;
            if (decoded.studentName) return `${decoded.studentName} (Student)`;
        } catch (e) {}
    }
    return fallbackActor;
}

app.get('/api/dev/clear-lockouts', async (req, res) => {
    try {
        await pool.query('DELETE FROM code_verification_failures');
        await pool.query('DELETE FROM ip_failures');
        res.send('All development lockout records cleared successfully.');
    } catch (err) {
        res.status(500).send('Error clearing lockouts: ' + err.message);
    }
});

async function logAuditActivity(action, details, ip, actor = 'System') {
    try {
        const cleanIp = normalizeClientIp(ip);
        await pool.query(
            'INSERT INTO audit_logs (action, details, ip_address, actor) VALUES ($1, $2, $3, $4)', 
            [action, JSON.stringify(details || {}), cleanIp, actor]
        );
    } catch (err) {
        console.error("Audit Log System Failure:", err.message);
    }
}

pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        action VARCHAR(100) NOT NULL,
        details TEXT,
        ip_address VARCHAR(50),
        actor VARCHAR(150) DEFAULT 'System',
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`).then(() => {
    pool.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor VARCHAR(150) DEFAULT 'System'`).catch(() => {});
}).catch(err => console.error("Error creating audit_logs table:", err.message));

pool.query(`
    CREATE TABLE IF NOT EXISTS ip_failures (
        ip VARCHAR(64) PRIMARY KEY,
        fails INT DEFAULT 0,
        lockout_until TIMESTAMPTZ,
        tier INT DEFAULT 1
    )
`).catch(err => console.error("Error creating ip_failures table:", err.message));

pool.query(`
    CREATE TABLE IF NOT EXISTS schools (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        code VARCHAR(50) UNIQUE NOT NULL,
        region VARCHAR(100),
        contact_person VARCHAR(100),
        contact_number VARCHAR(50),
        email VARCHAR(150),
        access_code VARCHAR(30) UNIQUE,
        sec_q1 TEXT,
        sec_a1 TEXT,
        sec_q2 TEXT,
        sec_a2 TEXT,
        is_blocked BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS archived_schools (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        code VARCHAR(50) UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS code_verification_failures (
        id SERIAL PRIMARY KEY,
        ip_address VARCHAR(50) UNIQUE,
        failed_attempts INT DEFAULT 0,
        lockout_until TIMESTAMP,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS coupon_requisitions (
        id SERIAL PRIMARY KEY,
        region VARCHAR(100) NOT NULL,
        school_code VARCHAR(50) NOT NULL,
        school_name VARCHAR(150) NOT NULL,
        standard_count INT DEFAULT 0,
        half_yearly_count INT DEFAULT 0,
        yearly_count INT DEFAULT 0,
        status VARCHAR(30) DEFAULT 'PENDING',
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        region VARCHAR(100) NOT NULL,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        amount DECIMAL(10, 2) NOT NULL,
        reference VARCHAR(100) UNIQUE NOT NULL,
        channel VARCHAR(50) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS coupons (
        id SERIAL PRIMARY KEY,
        school_name VARCHAR(150),
        school_code VARCHAR(50) NOT NULL,
        product_type VARCHAR(100),
        product_code VARCHAR(100) UNIQUE NOT NULL,
        payment_method VARCHAR(50),
        payment_status VARCHAR(50),
        inception_date VARCHAR(50) DEFAULT 'Not yet',
        exp_date VARCHAR(50) DEFAULT 'Not yet',
        used BOOLEAN DEFAULT FALSE,
        banned BOOLEAN DEFAULT FALSE,
        redeemed_by VARCHAR(150),
        student_name VARCHAR(150),
        whatsapp VARCHAR(50),
        bound_machine_id VARCHAR(150),
        linked_to VARCHAR(150),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS students (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        email VARCHAR(150),
        parent_whatsapp VARCHAR(50) DEFAULT '+233000000000',
        school_code VARCHAR(50) DEFAULT 'ONLINE-DIRECT',
        product_code VARCHAR(100),
        status VARCHAR(50) DEFAULT 'Active',
        user_type VARCHAR(50) DEFAULT 'student',
        whatsapp_enabled BOOLEAN DEFAULT TRUE,
        active_play_time_seconds INT DEFAULT 0,
        subject_times JSONB DEFAULT '{}'::jsonb,
        activities_completed INT DEFAULT 0,
        average_score NUMERIC(5,2) DEFAULT 0,
        challenges JSONB DEFAULT '[]'::jsonb,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS active_sessions (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(100),
        timestamp BIGINT
    );
`).then(() => {
    const cols = [
        'region VARCHAR(100)', 'contact_person VARCHAR(100)', 'contact_number VARCHAR(50)',
        'email VARCHAR(150)', 'access_code VARCHAR(30)', 'sec_q1 TEXT', 'sec_a1 TEXT',
        'sec_q2 TEXT', 'sec_a2 TEXT', 'is_blocked BOOLEAN DEFAULT FALSE'
    ];
    cols.forEach(col => {
        pool.query(`ALTER TABLE archived_schools ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
    });

    pool.query(`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS linked_to VARCHAR(150)`).catch(() => {});
    pool.query(`CREATE INDEX IF NOT EXISTS idx_students_parent_whatsapp ON students(parent_whatsapp)`).catch(() => {});
    pool.query(`CREATE INDEX IF NOT EXISTS idx_coupons_sch_prod ON coupons(school_code, product_code)`).catch(() => {});
    pool.query(`CREATE INDEX IF NOT EXISTS idx_coupons_product_code ON coupons(product_code)`).catch(() => {});
}).catch(err => console.error("Error creating security tables:", err.message));

async function checkIpLockout(ip) {
    if (isDeveloperIp(ip)) return { locked: false };

    const res = await pool.query('SELECT * FROM ip_failures WHERE ip = $1', [ip]);
    if (res.rows.length === 0) return { locked: false };
    
    const row = res.rows[0];
    const now = new Date();

    if (row.lockout_until && now < new Date(row.lockout_until)) {
        return {
            locked: true,
            message: "Security Lockout: Too many incorrect attempts. Your IP address is locked down for 24 hours."
        };
    }
    
    if (row.lockout_until && now >= new Date(row.lockout_until)) {
        await pool.query('UPDATE ip_failures SET fails = 0, lockout_until = NULL WHERE ip = $1', [ip]);
    }
    
    return { locked: false };
}

async function recordIpFailure(ip) {
    if (isDeveloperIp(ip)) return { fails: 0, locked: false };

    let res = await pool.query('SELECT * FROM ip_failures WHERE ip = $1', [ip]);
    const now = new Date();

    if (res.rows.length === 0) {
        await pool.query('INSERT INTO ip_failures (ip, fails, tier) VALUES ($1, 1, 1)', [ip]);
        return { fails: 1, locked: false };
    }
    
    let row = res.rows[0];
    let newFails = row.fails;
    
    if (row.lockout_until && now >= new Date(row.lockout_until)) {
        newFails = 0;
    }

    newFails += 1;
    let lockoutUntil = null;

    if (newFails >= 3) {
        lockoutUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }

    await pool.query(
        'UPDATE ip_failures SET fails = $1, lockout_until = $2 WHERE ip = $3',
        [newFails, lockoutUntil, ip]
    );

    return { fails: newFails, locked: !!lockoutUntil };
}

async function clearIpFailure(ip) {
    await pool.query('DELETE FROM ip_failures WHERE ip = $1', [ip]);
}

function generateSecureAccessCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let s1 = Array.from({length: 3}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    let s2 = Array.from({length: 3}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    let s3 = Array.from({length: 3}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    let s4 = Array.from({length: 4}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `${s1}-${s2}-${s3}-${s4}`;
}

function getRegionPrefix(regionName) {
    const map = {
        'Greater Accra': 'GAR', 'Ashanti Region': 'ASR', 'Bono Region': 'NER',
        'Bono East Region': 'BER', 'Ahafo Region': 'AHR', 'Central Region': 'CER',
        'Eastern Region': 'EAS', 'Northern Region': 'NOR', 'North East Region': 'NER',
        'Savannah Region': 'SAR', 'Upper East Region': 'UER', 'Upper West Region': 'UWR',
        'Volta Region': 'VOR', 'Oti Region': 'OTR', 'Western Region': 'WER',
        'Western North Region': 'WNR', 'Africa (Continental)': 'AFR', 'International (Global)': 'INT'
    };
    return map[regionName] || 'GAR';
}

app.post('/api/schools/register-independent', async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    try {
        const { name, region, contactPerson, contactNumber, email, secQ1, secA1, secQ2, secA2 } = req.body;
        
        if (!name || !region || !contactNumber || !email) {
            return res.status(400).json({ success: false, message: 'All mandatory institutional details are required.' });
        }

        const prefix = getRegionPrefix(region);
        let codeSlug = '';
        let isUniqueCode = false;

        while (!isUniqueCode) {
            const letters = Math.random().toString(36).substring(2, 5).toUpperCase();
            const digits = Math.floor(1000 + Math.random() * 9000);
            codeSlug = `${prefix}-${letters}${digits}`;
            const check = await pool.query('SELECT id FROM schools WHERE code = $1', [codeSlug]);
            if (check.rows.length === 0) isUniqueCode = true;
        }
        
        let accessKey = '';
        let isUnique = false;
        while (!isUnique) {
            accessKey = generateSecureAccessCode();
            const check = await pool.query('SELECT id FROM schools WHERE access_code = $1', [accessKey]);
            if (check.rows.length === 0) isUnique = true;
        }

        const insertRes = await pool.query(
            `INSERT INTO schools (name, code, region, contact_person, contact_number, email, access_code, sec_q1, sec_a1, sec_q2, sec_a2)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [name.trim(), codeSlug, region, contactPerson || 'Administrator', contactNumber.trim(), email.trim().toLowerCase(), accessKey, secQ1, secA1.trim().toLowerCase(), secQ2, secA2.trim().toLowerCase()]
        );

        const actorLabel = contactPerson ? `${contactPerson} (${name.trim()})` : name.trim();
        logAuditActivity("NEW_SCHOOL_REGISTERED", { schoolName: name.trim(), code: codeSlug, region }, clientIp, actorLabel);

        res.json({
            success: true,
            message: 'School registered successfully.',
            school: {
                name: insertRes.rows[0].name,
                code: insertRes.rows[0].code,
                accessKey: accessKey,
                region: insertRes.rows[0].region,
                contact_person: insertRes.rows[0].contact_person,
                contact_number: insertRes.rows[0].contact_number,
                email: insertRes.rows[0].email
            }
        });
    } catch (err) {
        console.error('Error in independent school registration:', err);
        res.status(500).json({ success: false, message: 'Server error during school registration.' });
    }
});

app.post('/api/schools/verify-access', async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');

    try {
        const lockoutStatus = await checkIpLockout(clientIp);
        if (lockoutStatus.locked) {
            return res.status(403).json({ success: false, lockedOut: true, message: lockoutStatus.message });
        }

        const { schoolCode, accessKey } = req.body;
        if (!schoolCode || !accessKey) {
            return res.status(400).json({ success: false, message: 'School Code and Access Key are required.' });
        }

        const cleanSchoolCode = schoolCode.trim().toUpperCase();
        const cleanAccessKey = accessKey.trim().toUpperCase();

        const ceoUserQuery = await pool.query(
            `SELECT * FROM schools WHERE UPPER(TRIM(code)) = 'CEO-HQ'`
        );

        let ceoMatch = false;
        if (ceoUserQuery.rows.length > 0) {
            const ceoRecord = ceoUserQuery.rows[0];
            if (cleanSchoolCode === 'CEO-HQ' && cleanAccessKey === ceoRecord.access_code.trim().toUpperCase()) {
                ceoMatch = true;
            }
        } else {
            if (cleanSchoolCode === 'CEO-HQ' && cleanAccessKey === 'ELORM-CEO-2026') {
                ceoMatch = true;
            }
        }

        if (ceoMatch) {
            await clearIpFailure(clientIp);
            const ceoToken = jwt.sign(
                { role: 'CEO', schoolCode: 'CEO-HQ', schoolName: 'CEO Master Command' },
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            logAuditActivity("MASTER_CEO_LOGIN", { status: "Success" }, clientIp, "CEO Master");

            return res.json({
                success: true,
                isCEO: true,
                redirectUrl: 'master-dashboard.html',
                sessionToken: ceoToken,
                message: 'CEO Master Authentication successful.'
            });
        }

        if (!isValidSchoolCodeFormat(cleanSchoolCode)) {
            const failData = await recordIpFailure(clientIp);
            return res.status(400).json({
                success: false,
                lockedOut: failData.locked,
                message: failData.locked ? 'Security Lockout: 3 incorrect attempts reached. Access locked for 24 hours.' : `Invalid School Code format. Codes must contain region prefix (e.g. OTR-53Z7426). (Attempt ${failData.fails} of 3)`
            });
        }

        const schoolQuery = await pool.query(
            `SELECT * FROM schools WHERE UPPER(TRIM(code)) = $1 AND UPPER(TRIM(access_code)) = $2`,
            [cleanSchoolCode, cleanAccessKey]
        );

        if (schoolQuery.rows.length === 0) {
            const failData = await recordIpFailure(clientIp);
            return res.status(400).json({
                success: false,
                lockedOut: failData.locked,
                message: failData.locked ? 'Security Lockout: 3 incorrect attempts reached. Access locked for 24 hours.' : `Invalid School Code or Access Key combination. (Attempt ${failData.fails} of 3)`
            });
        }

        const school = schoolQuery.rows[0];
        const schoolActor = `${school.contact_person || 'Admin'} (${school.name})`;

        if (school.is_blocked) {
            logAuditActivity("BLOCKED_SCHOOL_LOGIN_ATTEMPT", { code: cleanSchoolCode, schoolName: school.name }, clientIp, schoolActor);
            return res.status(403).json({ success: false, message: 'This institution account has been blocked by HQ.' });
        }

        await clearIpFailure(clientIp);

        const sessionToken = jwt.sign(
            { schoolCode: school.code, schoolName: school.name },
            JWT_SECRET,
            { expiresIn: '12h' }
        );

        logAuditActivity("SCHOOL_LOGIN_SUCCESS", { schoolName: school.name, schoolCode: school.code }, clientIp, schoolActor);

        res.json({
            success: true,
            isCEO: false,
            message: 'Access granted.',
            sessionToken: sessionToken,
            school: {
                name: school.name,
                code: school.code,
                region: school.region,
                contact_person: school.contact_person,
                contact_number: school.contact_number,
                email: school.email
            }
        });
    } catch (err) {
        console.error('School verification error:', err);
        res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

app.post('/api/schools/toggle-block', authenticateToken, async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    const actor = resolveActorFromReq(req, 'CEO Master');
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ success: false, message: 'School code is required.' });
        
        const schoolRes = await pool.query('SELECT * FROM schools WHERE UPPER(TRIM(code)) = UPPER(TRIM($1))', [code]);
        if (schoolRes.rows.length === 0) return res.status(404).json({ success: false, message: 'School not found.' });
        
        const currentStatus = schoolRes.rows[0].is_blocked || false;
        const newStatus = !currentStatus;
        await pool.query('UPDATE schools SET is_blocked = $1 WHERE UPPER(TRIM(code)) = UPPER(TRIM($2))', [newStatus, code]);
        
        logAuditActivity("SCHOOL_BLOCK_TOGGLED", { schoolName: schoolRes.rows[0].name, code, newStatus: newStatus ? 'Blocked' : 'Unblocked' }, clientIp, actor);
        res.json({ success: true, isBlocked: newStatus, message: `School successfully ${newStatus ? 'blocked' : 'unblocked'}.` });
    } catch (err) {
        console.error('Error toggling school block status:', err.message);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.post('/api/schools/update-access-code', authenticateToken, async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    const actor = resolveActorFromReq(req, 'CEO Master');
    try {
        const { code, newAccessCode } = req.body;
        if (!code || !newAccessCode) return res.status(400).json({ success: false, message: 'School code and new access code are required.' });
        
        const schoolRes = await pool.query('SELECT * FROM schools WHERE UPPER(TRIM(code)) = UPPER(TRIM($1))', [code]);
        if (schoolRes.rows.length === 0) return res.status(404).json({ success: false, message: 'School not found.' });
        
        await pool.query('UPDATE schools SET access_code = $1 WHERE UPPER(TRIM(code)) = UPPER(TRIM($2))', [newAccessCode.trim().toUpperCase(), code]);
        
        logAuditActivity("ACCESS_CODE_OVERRIDDEN", { schoolName: schoolRes.rows[0].name, code }, clientIp, actor);
        res.json({ success: true, message: 'Access code updated successfully.' });
    } catch (err) {
        console.error('Error updating access code:', err.message);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.post('/api/schools/update-code', authenticateToken, async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    const actor = resolveActorFromReq(req, 'CEO Master');
    try {
        const { oldCode, newCode } = req.body;
        const schoolRes = await pool.query('SELECT * FROM schools WHERE UPPER(TRIM(code)) = UPPER(TRIM($1))', [oldCode]);
        if (schoolRes.rows.length === 0) return res.status(404).json({ success: false, message: "School not found." });
        
        const updatedNewCode = newCode.trim().toUpperCase();
        if (!isValidSchoolCodeFormat(updatedNewCode)) {
            return res.status(400).json({ success: false, message: "Invalid new school code format. Must include valid region prefix (e.g. OTR-53Z7426)." });
        }

        await pool.query('UPDATE schools SET code = $1 WHERE UPPER(TRIM(code)) = UPPER(TRIM($2))', [updatedNewCode, oldCode]);
        await pool.query('UPDATE coupons SET school_code = $1 WHERE UPPER(TRIM(school_code)) = UPPER(TRIM($2))', [updatedNewCode, oldCode]);
        
        const updatedSchool = await pool.query('SELECT * FROM schools WHERE UPPER(TRIM(code)) = UPPER(TRIM($1))', [updatedNewCode]);
        
        logAuditActivity("SCHOOL_CODE_MIGRATED", { schoolName: schoolRes.rows[0].name, oldCode, newCode: updatedNewCode }, clientIp, actor);
        res.json({ success: true, school: updatedSchool.rows[0] });
    } catch (error) {
        console.error("Error updating school code:", error.message);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.post('/api/schools/archive', authenticateToken, async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    const actor = resolveActorFromReq(req, 'CEO Master');
    try {
        const { code } = req.body;
        if (code && code.trim().toUpperCase() === 'ONLINE-DIRECT') return res.status(400).json({ success: false, message: "Cannot archive Online Direct master category." });
        
        const schoolRes = await pool.query('SELECT * FROM schools WHERE UPPER(TRIM(code)) = UPPER(TRIM($1))', [code]);
        if (schoolRes.rows.length === 0) return res.status(404).json({ success: false, message: "School not found." });
        
        const school = schoolRes.rows[0];
        await pool.query('DELETE FROM schools WHERE UPPER(TRIM(code)) = UPPER(TRIM($1))', [code]);
        await pool.query(
            `INSERT INTO archived_schools (name, code, region, contact_person, contact_number, email, access_code, sec_q1, sec_a1, sec_q2, sec_a2, is_blocked) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [school.name, school.code.trim().toUpperCase(), school.region, school.contact_person, school.contact_number, school.email, school.access_code.trim().toUpperCase(), school.sec_q1, school.sec_a1, school.sec_q2, school.sec_a2, school.is_blocked]
        );
        
        logAuditActivity("SCHOOL_ARCHIVED", { schoolName: school.name, code }, clientIp, actor);
        res.json({ success: true, message: `School "${school.name}" archived successfully.` });
    } catch (error) {
        console.error("Error archiving school:", error.message);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.post('/api/schools/restore', authenticateToken, async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    const actor = resolveActorFromReq(req, 'CEO Master');
    try {
        const { code, originalCode } = req.body;
        const targetCode = (originalCode || code).trim().toUpperCase();
        const archivedRes = await pool.query('SELECT * FROM archived_schools WHERE UPPER(TRIM(code)) = UPPER(TRIM($1))', [targetCode]);
        if (archivedRes.rows.length === 0) return res.status(404).json({ success: false, message: "Archived school not found." });
        
        const school = archivedRes.rows[0];
        await pool.query('DELETE FROM archived_schools WHERE UPPER(TRIM(code)) = UPPER(TRIM($1))', [targetCode]);
        await pool.query(
            `INSERT INTO schools (name, code, region, contact_person, contact_number, email, access_code, sec_q1, sec_a1, sec_q2, sec_a2, is_blocked) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [school.name, code.trim().toUpperCase(), school.region, school.contact_person, school.contact_number, school.email, school.access_code.trim().toUpperCase(), school.sec_q1, school.sec_a1, school.sec_q2, school.sec_a2, school.is_blocked]
        );
        
        logAuditActivity("SCHOOL_RESTORED", { schoolName: school.name, code: code.trim().toUpperCase() }, clientIp, actor);
        res.json({ success: true, message: "School successfully restored." });
    } catch (error) {
        console.error("Error restoring school:", error.message);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.post('/api/schools/delete-archived', authenticateToken, async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    const actor = resolveActorFromReq(req, 'CEO Master');
    try {
        const { code } = req.body;
        if (!code) return res.status(400).json({ success: false, message: "School code is required." });
        
        const archivedRes = await pool.query('SELECT * FROM archived_schools WHERE UPPER(TRIM(code)) = UPPER(TRIM($1))', [code]);
        if (archivedRes.rows.length === 0) return res.status(404).json({ success: false, message: "Archived school not found." });
        
        const upperCode = code.trim().toUpperCase();
        await pool.query('DELETE FROM archived_schools WHERE UPPER(TRIM(code)) = UPPER(TRIM($1))', [upperCode]);
        await pool.query('DELETE FROM coupons WHERE UPPER(TRIM(school_code)) = UPPER(TRIM($1)) AND used = FALSE', [upperCode]);
        
        logAuditActivity("ARCHIVED_SCHOOL_PERMANENTLY_DELETED", { code: upperCode }, clientIp, actor);
        res.json({ success: true, message: "Archived school and its unassigned coupons permanently deleted." });
    } catch (error) {
        console.error("Error deleting archived school:", error.message);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.post('/api/restore-account', async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    try {
        const { schoolCode, productCode } = req.body;
        if (!schoolCode || !productCode) {
            return res.status(400).json({ success: false, message: "School Code and Product Code are required." });
        }

        const cleanSchoolCode = schoolCode.trim().toUpperCase();
        const cleanProductCode = productCode.trim().toUpperCase();

        const couponRes = await pool.query(
            'SELECT * FROM coupons WHERE UPPER(TRIM(school_code)) = $1 AND UPPER(TRIM(product_code)) = $2',
            [cleanSchoolCode, cleanProductCode]
        );

        if (couponRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "No matching account or coupon record found for this pair." });
        }

        const coupon = couponRes.rows[0];

        if (coupon.banned) {
            return res.status(400).json({ success: false, message: "This account/coupon code is permanently banned." });
        }

        const sessionToken = jwt.sign(
            { productCode: coupon.product_code.toUpperCase(), studentName: (coupon.student_name || 'STUDENT').toUpperCase(), schoolCode: coupon.school_code.toUpperCase() },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        logAuditActivity("ACCOUNT_RESTORED", { schoolCode: cleanSchoolCode, productCode: cleanProductCode }, clientIp, coupon.student_name || 'Student');

        res.json({
            success: true,
            message: "Account successfully restored!",
            sessionToken: sessionToken,
            studentName: coupon.student_name || 'STUDENT',
            email: coupon.redeemed_by || 'restored@elormacademy.com',
            schoolCode: coupon.school_code,
            productCode: coupon.product_code,
            whatsapp: coupon.whatsapp || '',
            expires: coupon.exp_date ? new Date(coupon.exp_date).getTime() : Date.now() + (30 * 24 * 60 * 60 * 1000)
        });
    } catch (error) {
        console.error("Error restoring account:", error.message);
        res.status(500).json({ success: false, message: "Server error during account restoration." });
    }
});

app.post('/api/delete-account', authenticateToken, async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    const authActor = resolveActorFromReq(req, 'System');
    try {
        const { email, productCode } = req.body;
        if (!productCode) return res.status(400).json({ success: false, message: "Product Code is required for secure account deletion." });

        const cleanProductCode = productCode.trim().toUpperCase();
        if (!isValidProductCodeFormat(cleanProductCode)) {
            return res.status(400).json({ success: false, message: "Invalid product code format." });
        }

        const couponRes = await pool.query('SELECT * FROM coupons WHERE UPPER(TRIM(product_code)) = $1', [cleanProductCode]);
        if (couponRes.rows.length === 0) return res.status(404).json({ success: false, message: "Associated subscription record not found." });

        const coupon = couponRes.rows[0];
        const targetEmail = coupon.redeemed_by || email;
        const targetSchoolCode = (coupon.school_code || 'ONLINE-DIRECT').trim().toUpperCase();
        const actor = `${authActor} -> deleted -> ${targetEmail || 'Student Account'}`;

        await pool.query(
            'DELETE FROM students WHERE UPPER(TRIM(product_code)) = $1 AND UPPER(TRIM(school_code)) = $2',
            [cleanProductCode, targetSchoolCode]
        );

        if (targetEmail) {
            await pool.query('DELETE FROM students WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))', [targetEmail]);
        }

        await pool.query('UPDATE coupons SET used = FALSE WHERE id = $1', [coupon.id]);

        logAuditActivity("STUDENT_ACCOUNT_DELETED", { email: targetEmail, productCode: cleanProductCode }, clientIp, actor);

        if (coupon.whatsapp && coupon.whatsapp !== "+233000000000") {
            try {
                await sendWhatsAppNotification({
                    name: coupon.student_name || 'Student',
                    parentWhatsapp: coupon.whatsapp,
                    expiryDate: coupon.exp_date || null
                }, {
                    activePlayTimeSeconds: 0,
                    activitiesCompleted: 0,
                    averageScore: 0,
                    challenges: [{ subject: 'Account', topic: 'Bright and Bold account deleted from elormacademy.com', durationSeconds: 0, percentage: 0 }]
                });
            } catch (err) {
                console.error("WhatsApp notification error on account deletion:", err.message);
            }
        }
        res.json({ success: true, message: "Account successfully deleted. Expiry date and original identity securely preserved." });
    } catch (error) {
        console.error("Error deleting account:", error.message);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.post('/api/requisitions/request', authenticateToken, async (req, res) => {
    try {
        const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
        const isDev = isDeveloperIp(clientIp);

        const { region, schoolCode, schoolName, standardCount, halfYearlyCount, yearlyCount } = req.body;
        
        if (!region || !schoolCode) {
            return res.status(400).json({ success: false, message: 'Region and school code are required.' });
        }

        const cleanSchoolCode = schoolCode.trim().toUpperCase();
        if (!isValidSchoolCodeFormat(cleanSchoolCode)) {
            return res.status(400).json({ success: false, message: "Invalid school code format. Must include valid region prefix (e.g. OTR-53Z7426)." });
        }

        const std = parseInt(standardCount) || 0;
        const half = parseInt(halfYearlyCount) || 0;
        const yearly = parseInt(yearlyCount) || 0;
        const totalPasses = std + half + yearly;

        const MIN_BULK_QUOTA = 5;
        if (totalPasses < MIN_BULK_QUOTA) {
            return res.status(400).json({ 
                success: false, 
                message: `Institutional requisitions require a minimum bulk order of ${MIN_BULK_QUOTA} passes.` 
            });
        }

        const countCheck = await pool.query(
            `SELECT COUNT(*) FROM coupon_requisitions 
             WHERE UPPER(TRIM(school_code)) = $1 
             AND requested_at >= CURRENT_DATE`,
            [cleanSchoolCode]
        );

        const submissionCount = parseInt(countCheck.rows[0].count, 10);

        if (!isDev && submissionCount >= 2) {
            return res.status(429).json({ 
                success: false, 
                message: 'Daily submission limit reached (Maximum 2 quota requests per day). To prevent spamming, submissions for this institution are frozen for 24 hours.' 
            });
        }

        await pool.query(
            `INSERT INTO coupon_requisitions (region, school_code, school_name, standard_count, half_yearly_count, yearly_count, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')`,
            [region, cleanSchoolCode, schoolName || 'Unknown School', std, half, yearly]
        );

        const actor = resolveActorFromReq(req, `${schoolName || 'School'} (${cleanSchoolCode})`);
        logAuditActivity("REQUISITION_SUBMITTED", { schoolCode: cleanSchoolCode, totalPasses }, clientIp, actor);

        res.json({ success: true, message: 'Requisition submitted successfully. Awaiting processing.' });
    } catch (err) {
        console.error('Error submitting requisition:', err);
        res.status(500).json({ success: false, message: 'Server error while submitting requisition.' });
    }
});

app.get('/api/requisitions', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM coupon_requisitions ORDER BY id DESC');
        res.json({ success: true, requisitions: result.rows });
    } catch (err) {
        console.error('Error fetching requisitions:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch requisitions.' });
    }
});

app.put('/api/requisitions/:id/approve', authenticateToken, async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    const actor = resolveActorFromReq(req, 'CEO Master');
    const { id } = req.params;

    try {
        const reqQuery = await pool.query('SELECT * FROM coupon_requisitions WHERE id = $1', [id]);
        if (reqQuery.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Requisition not found.' });
        }

        const reqData = reqQuery.rows[0];
        if (reqData.status === 'APPROVED') {
            return res.status(400).json({ success: false, message: 'Requisition has already been approved.' });
        }

        const helperGenerateCode = () => {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let s1 = Array.from({length: 3}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
            let s2 = Array.from({length: 3}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
            let s3 = Array.from({length: 3}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
            let s4 = Array.from({length: 4}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
            return `${s1}-${s2}-${s3}-${s4}`;
        };

        const batchTypes = [
            { count: reqData.standard_count, type: 'Monthly Pass' },
            { count: reqData.half_yearly_count, type: 'Half-Yearly Pass' },
            { count: reqData.yearly_count, type: 'Yearly Pass' }
        ];

        for (const batch of batchTypes) {
            for (let i = 0; i < batch.count; i++) {
                let code = '';
                let unique = false;
                while (!unique) {
                    code = helperGenerateCode().trim().toUpperCase();
                    const check = await pool.query('SELECT id FROM coupons WHERE UPPER(TRIM(product_code)) = $1', [code]);
                    if (check.rows.length === 0) unique = true;
                }

                await pool.query(
                    `INSERT INTO coupons (school_name, school_code, product_type, product_code, payment_method, payment_status, used, banned)
                     VALUES ($1, $2, $3, $4, 'direct', 'approved', FALSE, FALSE)`,
                    [reqData.school_name, (reqData.school_code || '').trim().toUpperCase(), batch.type, code]
                );
            }
        }

        await pool.query("UPDATE coupon_requisitions SET status = 'APPROVED' WHERE id = $1", [id]);
        
        logAuditActivity("REQUISITION_APPROVED", { schoolCode: reqData.school_code, requisitionId: id }, clientIp, actor);

        res.json({ success: true, message: 'Requisition approved and coupons successfully generated into system!' });
    } catch (err) {
        console.error('Error approving requisition:', err);
        res.status(500).json({ success: false, message: 'Server error during approval.' });
    }
});

app.put('/api/requisitions/:id/reject', authenticateToken, async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    const actor = resolveActorFromReq(req, 'CEO Master');
    const { id } = req.params;
    try {
        await pool.query("UPDATE coupon_requisitions SET status = 'REJECTED' WHERE id = $1", [id]);
        
        logAuditActivity("REQUISITION_REJECTED", { requisitionId: id }, clientIp, actor);

        res.json({ success: true, message: 'Requisition rejected.' });
    } catch (err) {
        console.error('Error rejecting requisition:', err);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.post('/api/payments', authenticateToken, async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    const isDev = isDeveloperIp(clientIp);
    const actor = resolveActorFromReq(req, req.body.name ? `${req.body.name} (Payer)` : 'CEO Master');

    const { name, region, date, amount, reference, channel, description } = req.body;
    
    if (!name || !amount || !reference) {
        return res.status(400).json({ success: false, message: "Payer Name, Amount, and Reference Number are required." });
    }

    try {
        const cleanName = name.trim();

        const countCheck = await pool.query(
            `SELECT COUNT(*) FROM payments 
             WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) 
             AND created_at >= CURRENT_DATE`,
            [cleanName]
        );

        const paymentCount = parseInt(countCheck.rows[0].count, 10);

        if (!isDev && paymentCount >= 2) {
            return res.status(429).json({ 
                success: false, 
                message: 'Daily payment submission limit reached (Maximum 2 payment records per day). To prevent spamming, submissions for this payer are frozen for 24 hours.' 
            });
        }

        const paymentDate = date ? new Date(date) : new Date();
        const newPayment = await pool.query(
            `INSERT INTO payments (name, region, date, amount, reference, channel, description) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [cleanName, region || 'General', paymentDate, parseFloat(amount), reference.trim(), channel || 'MoMo', description || '']
        );
        
        logAuditActivity("PAYMENT_RECORDED", { payerName: cleanName, amount: amount, reference }, clientIp, actor);

        res.json({ 
            success: true, 
            payment: newPayment.rows[0], 
            message: "Payment recorded successfully." 
        });
    } catch (err) {
        console.error("Error inserting payment:", err.message);
        if (err.code === '23505') { 
            return res.status(400).json({ 
                success: false, 
                message: "Conflict: A payment with this reference number already exists." 
            });
        }
        res.status(500).json({ success: false, message: "Server error saving payment record." });
    }
});

app.get('/api/payments', authenticateToken, async (req, res) => {
    try {
        const allPayments = await pool.query('SELECT * FROM payments ORDER BY date DESC, id DESC');
        res.json({ success: true, payments: allPayments.rows });
    } catch (err) {
        console.error("Error fetching payments:", err.message);
        res.status(500).json({ success: false, message: "Server error fetching payment ledger." });
    }
});

// STUDENT LOOKUP ROUTE FOR TOP-UP WORKFLOW
app.get('/api/students/lookup', async (req, res) => {
    try {
        const rawPhone = req.query.phone;
        if (!rawPhone) {
            return res.status(400).json({ success: false, message: "Phone number parameter is required." });
        }

        const cleanPhone = normalizePhoneNumber(rawPhone);
        if (cleanPhone.length < 6) {
            return res.json({ success: true, students: [] });
        }

        const query = `
            SELECT 
                COALESCE(s.id, 'std_' || SUBSTRING(MD5(c.product_code || c.school_code) FROM 1 FOR 8)) AS id,
                COALESCE(s.name, c.student_name, 'STUDENT') AS name,
                COALESCE(s.email, c.redeemed_by, '') AS email,
                COALESCE(s.parent_whatsapp, c.whatsapp, '') AS "parentWhatsapp",
                COALESCE(s.school_code, c.school_code, 'ONLINE-DIRECT') AS "schoolCode",
                COALESCE(s.product_code, c.product_code, '') AS "productCode",
                COALESCE(c.exp_date, 'Not yet') AS "expDate",
                CASE 
                    WHEN c.banned OR s.status = 'Deleted' THEN 'DELETED'
                    WHEN c.exp_date IS NOT NULL AND c.exp_date != 'Not yet' AND c.exp_date < CURRENT_DATE::text THEN 'EXPIRED'
                    WHEN c.used = TRUE THEN 'ACTIVE'
                    ELSE 'INACTIVE'
                END AS status
            FROM coupons c
            LEFT JOIN students s 
                ON UPPER(TRIM(s.product_code)) = UPPER(TRIM(c.product_code))
               AND UPPER(TRIM(s.school_code)) = UPPER(TRIM(c.school_code))
            WHERE (
                REGEXP_REPLACE(COALESCE(c.whatsapp, ''), '[^0-9]', '', 'g') LIKE '%' || $1 || '%'
                OR REGEXP_REPLACE(COALESCE(s.parent_whatsapp, ''), '[^0-9]', '', 'g') LIKE '%' || $1 || '%'
            )
            AND (c.student_name IS NOT NULL OR s.name IS NOT NULL)
            ORDER BY c.id DESC
        `;

        const result = await pool.query(query, [cleanPhone]);
        res.json({ success: true, students: result.rows });
    } catch (error) {
        console.error("Error looking up student accounts by phone:", error.message);
        res.status(500).json({ success: false, message: "Server error looking up accounts." });
    }
});

// EXISTING STUDENT COUPON TOP-UP ROUTE
app.post('/api/coupons/topup', async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    try {
        const lockoutStatus = await checkIpLockout(clientIp);
        if (lockoutStatus.locked) {
            return res.status(429).json({ success: false, message: lockoutStatus.message });
        }

        const { schoolCode, productCode, studentId, studentName, phone, whatsapp } = req.body;
        if (!schoolCode || !productCode) {
            return res.status(400).json({ success: false, message: "School Code and Product Code are required." });
        }

        const sCodeNormalized = schoolCode.trim().toUpperCase();
        const pCodeNormalized = productCode.trim().toUpperCase();

        if (!isValidSchoolCodeFormat(sCodeNormalized) || !isValidProductCodeFormat(pCodeNormalized)) {
            const failData = await recordIpFailure(clientIp);
            return res.status(400).json({ 
                success: false, 
                message: failData.locked ? 'Security Lockout: 3 incorrect attempts reached. Access locked for 24 hours.' : `Invalid code format. (Attempt ${failData.fails} of 3)` 
            });
        }

        const newCouponRes = await pool.query(
            'SELECT * FROM coupons WHERE UPPER(TRIM(school_code)) = $1 AND UPPER(TRIM(product_code)) = $2',
            [sCodeNormalized, pCodeNormalized]
        );

        if (newCouponRes.rows.length === 0) {
            const failData = await recordIpFailure(clientIp);
            return res.status(404).json({ 
                success: false, 
                message: failData.locked ? 'Security Lockout: 3 incorrect attempts reached. Access locked for 24 hours.' : `Invalid School Code and Coupon Code combination. (Attempt ${failData.fails} of 3)` 
            });
        }

        const newCoupon = newCouponRes.rows[0];
        if (newCoupon.banned) {
            return res.status(400).json({ success: false, message: "This coupon is permanently banned." });
        }
        if (newCoupon.used) {
            return res.status(400).json({ success: false, message: "This coupon code has already been redeemed." });
        }

        let studentCoupon = null;
        if (studentId) {
            const stuRes = await pool.query('SELECT * FROM students WHERE id = $1 LIMIT 1', [studentId]);
            if (stuRes.rows.length > 0 && stuRes.rows[0].product_code) {
                const cRes = await pool.query('SELECT * FROM coupons WHERE UPPER(TRIM(product_code)) = UPPER(TRIM($1))', [stuRes.rows[0].product_code]);
                if (cRes.rows.length > 0) studentCoupon = cRes.rows[0];
            }
        }

        if (!studentCoupon && studentName) {
            const cRes = await pool.query('SELECT * FROM coupons WHERE UPPER(TRIM(student_name)) = UPPER(TRIM($1)) ORDER BY id DESC LIMIT 1', [studentName]);
            if (cRes.rows.length > 0) studentCoupon = cRes.rows[0];
        }

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        let baseDate = today;
        if (studentCoupon && studentCoupon.exp_date && studentCoupon.exp_date !== "Not yet") {
            const currentExpDate = new Date(studentCoupon.exp_date);
            if (!isNaN(currentExpDate.getTime()) && studentCoupon.exp_date >= todayStr) {
                baseDate = currentExpDate;
            }
        }

        const newExpiryDate = addDurationToDate(baseDate, newCoupon.product_type);
        const resolvedName = (studentName || (studentCoupon && studentCoupon.student_name) || 'Student').trim().toUpperCase();
        const resolvedWhatsapp = whatsapp || phone || (studentCoupon && studentCoupon.whatsapp) || '+233000000000';
        const targetLink = studentCoupon ? `${studentCoupon.school_code}::${studentCoupon.product_code}` : 'ACCOUNT_TOPUP';

        await pool.query(
            `UPDATE coupons SET 
                used = TRUE, 
                banned = FALSE, 
                inception_date = $1, 
                exp_date = $2, 
                redeemed_by = $3, 
                student_name = $4, 
                whatsapp = $5,
                linked_to = $6 
             WHERE id = $7`,
            [todayStr, newExpiryDate, (studentCoupon ? studentCoupon.redeemed_by : null), resolvedName, resolvedWhatsapp, targetLink, newCoupon.id]
        );

        if (studentCoupon) {
            await pool.query(
                `UPDATE coupons SET exp_date = $1, banned = FALSE, used = TRUE WHERE id = $2`,
                [newExpiryDate, studentCoupon.id]
            );

            await pool.query(
                `UPDATE students SET status = 'Active', parent_whatsapp = $1 WHERE UPPER(TRIM(product_code)) = UPPER(TRIM($2))`,
                [resolvedWhatsapp, studentCoupon.product_code]
            );
        } else if (studentId) {
            await pool.query(
                `UPDATE students SET status = 'Active', parent_whatsapp = $1 WHERE id = $2`,
                [resolvedWhatsapp, studentId]
            );
        }

        await clearIpFailure(clientIp);

        const actor = `${resolvedName} (Top-Up)`;
        logAuditActivity("COUPON_TOPUP_EXECUTED", { appliedCode: pCodeNormalized, targetLink, newExpiryDate }, clientIp, actor);

        res.json({
            success: true,
            message: `Subscription successfully extended until ${newExpiryDate}!`,
            newExpiryDate: newExpiryDate
        });
    } catch (error) {
        console.error("Error executing coupon top-up:", error.message);
        res.status(500).json({ success: false, message: "Server error during top-up." });
    }
});

// ONLINE (PAYSTACK) TOP-UP VERIFICATION ROUTE
app.post('/api/paystack/verify-topup', async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    try {
        const { reference, studentId, studentName, email, phone, plan, amount } = req.body;

        if (!reference) {
            return res.status(400).json({ success: false, message: "Payment reference is required." });
        }

        const cleanRef = reference.trim().toUpperCase();

        let studentCoupon = null;
        if (studentId) {
            const stuRes = await pool.query('SELECT * FROM students WHERE id = $1 LIMIT 1', [studentId]);
            if (stuRes.rows.length > 0 && stuRes.rows[0].product_code) {
                const cRes = await pool.query('SELECT * FROM coupons WHERE UPPER(TRIM(product_code)) = UPPER(TRIM($1))', [stuRes.rows[0].product_code]);
                if (cRes.rows.length > 0) studentCoupon = cRes.rows[0];
            }
        }

        if (!studentCoupon && studentName) {
            const cRes = await pool.query('SELECT * FROM coupons WHERE UPPER(TRIM(student_name)) = UPPER(TRIM($1)) ORDER BY id DESC LIMIT 1', [studentName]);
            if (cRes.rows.length > 0) studentCoupon = cRes.rows[0];
        }

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        let baseDate = today;
        if (studentCoupon && studentCoupon.exp_date && studentCoupon.exp_date !== "Not yet") {
            const currentExpDate = new Date(studentCoupon.exp_date);
            if (!isNaN(currentExpDate.getTime()) && studentCoupon.exp_date >= todayStr) {
                baseDate = currentExpDate;
            }
        }

        const newExpiryDate = addDurationToDate(baseDate, plan);
        const resolvedName = (studentName || (studentCoupon && studentCoupon.student_name) || 'Student').trim().toUpperCase();
        const resolvedEmail = (email || (studentCoupon && studentCoupon.redeemed_by) || `${resolvedName.toLowerCase().replace(/[^a-z0-9]/g, '')}@elormacademy.com`).trim().toLowerCase();
        const resolvedPhone = (phone || (studentCoupon && studentCoupon.whatsapp) || '+233000000000').trim();
        const targetLink = studentCoupon ? `${studentCoupon.school_code}::${studentCoupon.product_code}` : 'ONLINE_TOPUP';

        const paymentAmount = amount ? (parseFloat(amount) / 100) : 50.00;
        await pool.query(
            `INSERT INTO payments (name, region, date, amount, reference, channel, description)
             VALUES ($1, 'General', CURRENT_TIMESTAMP, $2, $3, 'Paystack Online', $4)
             ON CONFLICT (reference) DO NOTHING`,
            [resolvedName, paymentAmount, cleanRef, `Online Top-Up (${plan || 'Monthly Pass'})`]
        );

        await pool.query(
            `INSERT INTO coupons (school_name, school_code, product_type, product_code, payment_method, payment_status, used, banned, inception_date, exp_date, redeemed_by, student_name, whatsapp, linked_to)
             VALUES ('Online Direct', 'ONLINE-DIRECT', $1, $2, 'paystack', 'approved', TRUE, FALSE, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (product_code) DO UPDATE SET exp_date = EXCLUDED.exp_date, used = TRUE`,
            [plan || "Paystack Direct Pass", cleanRef, todayStr, newExpiryDate, resolvedEmail, resolvedName, resolvedPhone, targetLink]
        );

        if (studentCoupon) {
            await pool.query(
                `UPDATE coupons SET exp_date = $1, banned = FALSE, used = TRUE WHERE id = $2`,
                [newExpiryDate, studentCoupon.id]
            );

            await pool.query(
                `UPDATE students SET status = 'Active', parent_whatsapp = $1 WHERE UPPER(TRIM(product_code)) = UPPER(TRIM($2))`,
                [resolvedPhone, studentCoupon.product_code]
            );
        } else if (studentId) {
            await pool.query(
                `UPDATE students SET status = 'Active', parent_whatsapp = $1 WHERE id = $2`,
                [resolvedPhone, studentId]
            );
        }

        const actor = `${resolvedName} (Paystack Online Top-Up)`;
        logAuditActivity("PAYSTACK_TOPUP_VERIFIED", { reference: cleanRef, targetLink, newExpiryDate }, clientIp, actor);

        res.json({
            success: true,
            message: `Online top-up successfully processed! Access extended until ${newExpiryDate}.`,
            newExpiryDate: newExpiryDate
        });
    } catch (error) {
        console.error("Error verifying Paystack top-up:", error.message);
        res.status(500).json({ success: false, message: "Server error verifying online top-up." });
    }
});

app.post('/api/auth/verify-session', async (req, res) => {
    try {
        const { productCode, schoolCode, sessionToken } = req.body;
        
        if (!productCode) {
            return res.status(400).json({ success: false, active: false, message: "Missing session product code." });
        }

        const cleanProductCode = productCode.trim().toUpperCase();

        if (!isValidProductCodeFormat(cleanProductCode)) {
            return res.status(400).json({ success: false, active: false, message: "Invalid product code format. Access strictly denied." });
        }

        if (sessionToken) {
            if (sessionToken === 'restored_active_grace' || sessionToken === 'paystack_active_grace' || sessionToken === 'development_bypass_token') {
                // Allow graceful active tokens issued during account restoration or paystack verification
            } else {
                try {
                    const decoded = jwt.verify(sessionToken, JWT_SECRET);
                    if (decoded.productCode && decoded.productCode.toUpperCase() !== cleanProductCode) {
                        return res.status(401).json({ success: false, active: false, message: "Token signature mismatch." });
                    }
                } catch (jwtErr) {
                    return res.status(401).json({ success: false, active: false, message: "Invalid or forged session token signature." });
                }
            }
        } else {
            return res.status(401).json({ success: false, active: false, message: "Missing cryptographic session token." });
        }

        let couponQuery = 'SELECT * FROM coupons WHERE UPPER(TRIM(product_code)) = $1';
        let queryParams = [cleanProductCode];

        if (schoolCode) {
            const cleanSchoolCode = schoolCode.trim().toUpperCase();
            if (!isValidSchoolCodeFormat(cleanSchoolCode)) {
                return res.json({ success: false, active: false, message: "Invalid school code format. Access strictly denied." });
            }
            couponQuery += ' AND UPPER(TRIM(school_code)) = $2';
            queryParams.push(cleanSchoolCode);
        }

        const couponRes = await pool.query(couponQuery, queryParams);

        if (couponRes.rows.length === 0) {
            return res.json({ success: false, active: false, message: "No active subscription pass found for this code combination on server." });
        }

        const coupon = couponRes.rows[0];

        if (!isValidSchoolCodeFormat(coupon.school_code) || !isValidProductCodeFormat(coupon.product_code)) {
            return res.json({ success: false, active: false, message: "Legacy or invalid code format in database." });
        }

        const todayStr = new Date().toISOString().split('T')[0];

        if (!coupon.used || coupon.banned || (coupon.exp_date && coupon.exp_date !== "Not yet" && coupon.exp_date < todayStr)) {
            if (coupon.exp_date && coupon.exp_date !== "Not yet" && coupon.exp_date < todayStr) {
                await pool.query('UPDATE coupons SET banned = TRUE WHERE id = $1', [coupon.id]);
            }
            return res.json({ success: false, active: false, expired: true, message: "Subscription pass has expired, been reset, or is invalid." });
        }

        res.json({ 
            success: true, 
            active: true, 
            studentName: coupon.student_name || 'Student',
            schoolCode: coupon.school_code,
            productCode: coupon.product_code,
            expiryDate: coupon.exp_date,
            message: "Session authenticated successfully by server." 
        });
    } catch (error) {
        console.error("Error in /api/auth/verify-session:", error.message);
        res.status(500).json({ success: false, message: "Server error during session authentication." });
    }
});

app.get('/api/schools', authenticateToken, async (req, res) => {
    try {
        const schoolsRes = await pool.query('SELECT * FROM schools ORDER BY id DESC');
        const archivedRes = await pool.query('SELECT * FROM archived_schools ORDER BY id DESC');
        
        let schoolsList = schoolsRes.rows;
        if (!schoolsList.some(s => s.code && s.code.toUpperCase() === 'ONLINE-DIRECT')) {
            schoolsList.unshift({ id: 0, name: 'Online Direct', code: 'ONLINE-DIRECT' });
        }

        res.json({ success: true, schools: schoolsList, archivedSchools: archivedRes.rows });
    } catch (error) {
        console.error("Error fetching schools:", error.message);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.post('/api/schools', authenticateToken, async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    const actor = resolveActorFromReq(req, 'CEO Master');
    try {
        const { name, code } = req.body;
        if (!name || !code) {
            return res.status(400).json({ success: false, message: "School name and code are required." });
        }
        const cleanCode = code.trim().toUpperCase();
        if (!isValidSchoolCodeFormat(cleanCode)) {
            return res.status(400).json({ success: false, message: "Invalid school code format. Must include valid region prefix (e.g. OTR-53Z7426)." });
        }

        const existsRes = await pool.query('SELECT * FROM schools WHERE UPPER(TRIM(code)) = $1 OR LOWER(TRIM(name)) = LOWER(TRIM($2))', [cleanCode, name.trim()]);
        if (existsRes.rows.length > 0) {
            return res.status(400).json({ success: false, message: "School already exists." });
        }
        await pool.query('INSERT INTO schools (name, code) VALUES ($1, $2)', [name.trim(), cleanCode]);
        
        logAuditActivity("MANUAL_SCHOOL_REGISTERED", { schoolName: name.trim(), code: cleanCode }, clientIp, actor);

        res.json({ success: true, message: "School registered successfully." });
    } catch (error) {
        console.error("Error registering school:", error.message);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.get('/api/coupons', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM coupons ORDER BY id DESC');
        const formatted = result.rows.map(c => ({
            schoolName: c.school_name,
            schoolCode: c.school_code,
            productType: c.product_type,
            productCode: c.product_code,
            paymentMethod: c.payment_method,
            paymentStatus: c.payment_status,
            inceptionDate: c.inception_date,
            expDate: c.exp_date,
            used: c.used,
            banned: c.banned,
            redeemedBy: c.redeemed_by,
            studentName: c.student_name || null,
            whatsapp: c.whatsapp,
            boundMachineId: c.bound_machine_id,
            linkedTo: c.linked_to
        }));
        res.json({ success: true, coupons: formatted });
    } catch (error) {
        console.error("Error fetching coupons:", error.message);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.post('/api/coupons', authenticateToken, async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    const actor = resolveActorFromReq(req, 'CEO Master');
    try {
        const c = req.body;
        const rawProductCode = c.productCode || c.product_code || c.code || c.couponCode;
        const rawSchoolCode = c.schoolCode || c.school_code || 'ONLINE-DIRECT';

        if (!rawProductCode) {
            return res.status(400).json({ success: false, message: "Invalid coupon data." });
        }
        const cleanProductCode = rawProductCode.trim().toUpperCase();
        const cleanSchoolCode = rawSchoolCode.trim().toUpperCase();

        if (!isValidSchoolCodeFormat(cleanSchoolCode) || !isValidProductCodeFormat(cleanProductCode)) {
            return res.status(400).json({ success: false, message: "Invalid format for School Code or Product Code." });
        }

        await pool.query(
            `INSERT INTO coupons (school_name, school_code, product_type, product_code, payment_method, payment_status, inception_date, exp_date, used, banned, redeemed_by, student_name, whatsapp, bound_machine_id, linked_to)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             ON CONFLICT (product_code) DO UPDATE SET
             school_name = EXCLUDED.school_name,
             school_code = EXCLUDED.school_code,
             product_type = EXCLUDED.product_type,
             payment_method = EXCLUDED.payment_method,
             payment_status = EXCLUDED.payment_status,
             linked_to = EXCLUDED.linked_to`,
            [c.schoolName || c.school_name || 'Online Direct', cleanSchoolCode, c.productType || c.product_type || 'Paystack Direct Pass', cleanProductCode, c.paymentMethod || c.payment_method || 'direct_company', c.paymentStatus || c.payment_status || 'approved', c.inceptionDate || c.inception_date || 'Not yet', c.expDate || c.exp_date || 'Not yet', c.used || false, c.banned || false, c.redeemedBy || c.redeemed_by || null, c.studentName || c.student_name || null, c.whatsapp || null, c.boundMachineId || c.bound_machine_id || null, c.linkedTo || c.linked_to || null]
        );
        
        logAuditActivity("COUPON_GENERATED", { productCode: cleanProductCode, schoolCode: cleanSchoolCode }, clientIp, actor);

        res.json({ success: true, message: "Coupon saved successfully." });
    } catch (error) {
        console.error("Error saving coupon:", error.message);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.post('/api/coupons/delete', authenticateToken, async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    const actor = resolveActorFromReq(req, 'CEO Master');
    try {
        const { productCode, product_code, code, couponCode } = req.body;
        const rawCode = productCode || product_code || code || couponCode;
        if (!rawCode) {
            return res.status(400).json({ success: false, message: "Product code is required." });
        }
        const cleanProductCode = rawCode.trim().toUpperCase();
        const couponRes = await pool.query('SELECT * FROM coupons WHERE UPPER(TRIM(product_code)) = $1', [cleanProductCode]);
        if (couponRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Coupon not found." });
        }
        if (couponRes.rows[0].used) {
            return res.status(400).json({ success: false, message: "Cannot delete an active, redeemed coupon." });
        }
        await pool.query('DELETE FROM coupons WHERE UPPER(TRIM(product_code)) = $1', [cleanProductCode]);
        
        logAuditActivity("COUPON_DELETED", { productCode: cleanProductCode }, clientIp, actor);

        res.json({ success: true, message: "Coupon deleted successfully." });
    } catch (error) {
        console.error("Error deleting coupon:", error.message);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.post('/api/coupons/reset', authenticateToken, async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    const actor = resolveActorFromReq(req, 'CEO Master');
    try {
        const { productCode, product_code, code, couponCode } = req.body;
        const rawCode = productCode || product_code || code || couponCode;
        if (!rawCode) {
            return res.status(400).json({ success: false, message: "Product code is required." });
        }

        const cleanProductCode = rawCode.trim().toUpperCase();
        const couponRes = await pool.query('SELECT * FROM coupons WHERE UPPER(TRIM(product_code)) = $1', [cleanProductCode]);
        if (couponRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Coupon not found." });
        }

        const coupon = couponRes.rows[0];
        const redeemedEmail = coupon.redeemed_by;
        const targetSchoolCode = (coupon.school_code || 'ONLINE-DIRECT').trim().toUpperCase();

        await pool.query(
            `UPDATE coupons SET used = FALSE, banned = FALSE, inception_date = 'Not yet', exp_date = 'Not yet', redeemed_by = NULL, student_name = NULL, whatsapp = NULL, linked_to = NULL WHERE UPPER(TRIM(product_code)) = $1`,
            [cleanProductCode]
        );

        await pool.query(
            `DELETE FROM students WHERE UPPER(TRIM(product_code)) = $1 AND UPPER(TRIM(school_code)) = $2`,
            [cleanProductCode, targetSchoolCode]
        );

        if (redeemedEmail) {
            await pool.query('DELETE FROM students WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))', [redeemedEmail]);
        }

        logAuditActivity("COUPON_RESET", { productCode: cleanProductCode, previousUser: redeemedEmail || 'None' }, clientIp, actor);

        res.json({ success: true, message: `Coupon ${cleanProductCode} successfully reset and unlocked for student reuse!` });
    } catch (error) {
        console.error("Error resetting coupon:", error.message);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.post('/api/coupons/redeem', async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    try {
        const lockoutStatus = await checkIpLockout(clientIp);
        if (lockoutStatus.locked) {
            return res.status(429).json({ success: false, message: lockoutStatus.message });
        }

        const rawSchoolCode = req.body.schoolCode || req.body.school_code || req.body.code;
        const rawProductCode = req.body.productCode || req.body.product_code || req.body.couponCode || req.body.coupon;
        const { email, whatsapp, studentName, student_name } = req.body;
        
        if (!rawSchoolCode || !rawProductCode) {
            return res.status(400).json({ success: false, message: "School Code and Product Code are required." });
        }

        const sCodeNormalized = rawSchoolCode.trim().toUpperCase();
        const pCodeNormalized = rawProductCode.trim().toUpperCase();

        if (!isValidSchoolCodeFormat(sCodeNormalized)) {
            const failData = await recordIpFailure(clientIp);
            return res.status(400).json({ 
                success: false, 
                message: failData.locked ? 'Security Lockout: 3 incorrect attempts reached. Access locked for 24 hours.' : `Invalid School Code format. Must include region prefix (e.g. OTR-53Z7426). (Attempt ${failData.fails} of 3)` 
            });
        }

        if (!isValidProductCodeFormat(pCodeNormalized)) {
            const failData = await recordIpFailure(clientIp);
            return res.status(400).json({ 
                success: false, 
                message: failData.locked ? 'Security Lockout: 3 incorrect attempts reached. Access locked for 24 hours.' : `Invalid Product Code format. (Attempt ${failData.fails} of 3)` 
            });
        }

        let schoolExists = sCodeNormalized === 'ONLINE-DIRECT';

        if (!schoolExists) {
            const schoolRes = await pool.query('SELECT * FROM schools WHERE UPPER(TRIM(code)) = $1', [sCodeNormalized]);
            if (schoolRes.rows.length > 0) {
                if (schoolRes.rows[0].is_blocked) {
                    return res.status(403).json({ success: false, message: "This institution has been blocked by HQ." });
                }
                schoolExists = true;
            }
        }

        if (!schoolExists) {
            const failData = await recordIpFailure(clientIp);
            return res.status(404).json({ 
                success: false, 
                message: failData.locked ? 'Security Lockout: 3 incorrect attempts reached. Access locked for 24 hours.' : `Invalid School Code. (Attempt ${failData.fails} of 3)` 
            });
        }

        const couponRes = await pool.query(
            'SELECT * FROM coupons WHERE UPPER(TRIM(school_code)) = $1 AND UPPER(TRIM(product_code)) = $2',
            [sCodeNormalized, pCodeNormalized]
        );

        if (couponRes.rows.length === 0) {
            const failData = await recordIpFailure(clientIp);
            return res.status(404).json({ 
                success: false, 
                message: failData.locked ? 'Security Lockout: 3 incorrect attempts reached. Access locked for 24 hours.' : `Invalid School Code and Product Code combination. (Attempt ${failData.fails} of 3)` 
            });
        }

        const coupon = couponRes.rows[0];
        if (coupon.banned) {
            const failData = await recordIpFailure(clientIp);
            return res.status(400).json({ 
                success: false, 
                message: failData.locked ? 'Security Lockout: 3 incorrect attempts reached. Access locked for 24 hours.' : `This coupon code is permanently banned. (Attempt ${failData.fails} of 3)` 
            });
        }

        const nowUtc = new Date();
        const todayStr = nowUtc.toISOString().split('T')[0];

        const isRestoration = Boolean(coupon.used && coupon.student_name && coupon.redeemed_by && email && email.trim().toLowerCase() === coupon.redeemed_by.toLowerCase());

        let resolvedStudentName, resolvedEmail, resolvedWhatsapp;

        if (isRestoration) {
            resolvedStudentName = coupon.student_name;
            resolvedEmail = coupon.redeemed_by;
            resolvedWhatsapp = coupon.whatsapp;
        } else {
            if (coupon.used && (!email || email.trim().toLowerCase() !== (coupon.redeemed_by || '').toLowerCase())) {
                return res.status(400).json({ success: false, message: "This coupon code has already been redeemed by another account." });
            }
            const rawName = studentName || student_name;
            resolvedStudentName = rawName ? rawName.trim().toUpperCase() : (email ? email.trim().split('@')[0].toUpperCase() : 'STUDENT');
            resolvedEmail = email ? email.trim().toLowerCase() : null;
            resolvedWhatsapp = whatsapp ? whatsapp.trim() : "+233000000000";
        }

        if (coupon.exp_date && coupon.exp_date !== "Not yet" && coupon.exp_date < todayStr) {
            await pool.query('UPDATE coupons SET banned = TRUE, used = TRUE WHERE id = $1', [coupon.id]);
            await recordIpFailure(clientIp);
            return res.status(400).json({ success: false, message: "This coupon code has expired and is now banned." });
        }

        let calculatedExpDate = coupon.exp_date;

        if (!isRestoration || calculatedExpDate === "Not yet" || !calculatedExpDate) {
            const expDate = new Date(nowUtc);
            const productType = coupon.product_type || "Monthly";
            
            if (productType.includes("Monthly") || productType.includes("Paystack")) {
                expDate.setUTCMonth(expDate.getUTCMonth() + 1);
            } else if (productType.includes("Half-Yearly")) {
                expDate.setUTCMonth(expDate.getUTCMonth() + 6);
            } else if (productType.includes("Yearly")) {
                expDate.setUTCFullYear(expDate.getUTCFullYear() + 1);
            } else {
                expDate.setUTCMonth(expDate.getUTCMonth() + 1);
            }
            calculatedExpDate = expDate.toISOString().split('T')[0];
        }

        const inceptionToUse = (isRestoration && coupon.inception_date && coupon.inception_date !== "Not yet") ? coupon.inception_date : todayStr;

        if (!isRestoration) {
            await pool.query(
                `DELETE FROM students WHERE UPPER(TRIM(product_code)) = $1 AND UPPER(TRIM(school_code)) = $2`,
                [pCodeNormalized, sCodeNormalized]
            );

            const studentId = 'std_' + Math.random().toString(36).substring(2, 9);
            await pool.query(
                `INSERT INTO students (
                    id, name, email, parent_whatsapp, school_code, product_code, status,
                    active_play_time_seconds, subject_times, activities_completed, average_score, challenges, joined_at
                 ) VALUES ($1, $2, $3, $4, $5, $6, 'Active', 0, '{}'::jsonb, 0, 0, '[]'::jsonb, CURRENT_TIMESTAMP)`,
                [studentId, resolvedStudentName, resolvedEmail, resolvedWhatsapp, sCodeNormalized, pCodeNormalized]
            );
        } else {
            await pool.query(
                `UPDATE students SET 
                    name = $1, 
                    email = $2, 
                    parent_whatsapp = $3, 
                    status = 'Active' 
                 WHERE UPPER(TRIM(product_code)) = $4 AND UPPER(TRIM(school_code)) = $5`,
                [resolvedStudentName, resolvedEmail, resolvedWhatsapp, pCodeNormalized, sCodeNormalized]
            );
        }

        await pool.query(
            `UPDATE coupons SET used = TRUE, banned = FALSE, inception_date = $1, exp_date = $2, redeemed_by = $3, student_name = $4, whatsapp = $5 WHERE id = $6`,
            [inceptionToUse, calculatedExpDate, resolvedEmail, resolvedStudentName, resolvedWhatsapp, coupon.id]
        );

        await clearIpFailure(clientIp);

        const updatedCouponRes = await pool.query('SELECT * FROM coupons WHERE id = $1', [coupon.id]);
        const c = updatedCouponRes.rows[0];

        const sessionToken = jwt.sign(
            { productCode: c.product_code.toUpperCase(), studentName: c.student_name.toUpperCase(), schoolCode: c.school_code.toUpperCase() },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        const actor = `${resolvedStudentName} (${resolvedEmail || sCodeNormalized})`;
        logAuditActivity("COUPON_REDEEMED", { productCode: pCodeNormalized, email: resolvedEmail, schoolCode: sCodeNormalized }, clientIp, actor);

        res.json({
            success: true,
            message: isRestoration ? `Welcome back! Account successfully restored.` : "Coupon successfully activated!",
            sessionToken: sessionToken,
            coupon: {
                schoolName: c.school_name,
                schoolCode: c.school_code,
                productType: c.product_type,
                productCode: c.product_code,
                paymentMethod: c.payment_method,
                paymentStatus: c.payment_status,
                inceptionDate: c.inception_date,
                expDate: c.exp_date,
                used: c.used,
                banned: c.banned,
                redeemedBy: c.redeemed_by,
                studentName: c.student_name,
                whatsapp: c.whatsapp,
                boundMachineId: c.bound_machine_id,
                linkedTo: c.linked_to
            }
        });
    } catch (error) {
        console.error("Error redeeming coupon:", error.message);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.post('/api/coupons/verify', async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    try {
        const rawProductCode = req.body.productCode || req.body.product_code || req.body.couponCode || req.body.code;
        const rawSchoolCode = req.body.schoolCode || req.body.school_code;
        const { email, contact, whatsapp, studentName, student_name } = req.body;
        
        if (!rawProductCode) {
            return res.status(400).json({ success: false, message: "Product/Coupon Code is required." });
        }

        const cleanProductCode = rawProductCode.trim().toUpperCase();
        if (!isValidProductCodeFormat(cleanProductCode)) {
            return res.status(400).json({ success: false, message: "Invalid product code format." });
        }

        const couponRes = await pool.query('SELECT * FROM coupons WHERE UPPER(TRIM(product_code)) = $1', [cleanProductCode]);
        if (couponRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Invalid coupon code." });
        }

        const coupon = couponRes.rows[0];
        if (coupon.banned) {
            return res.status(400).json({ success: false, message: "This coupon code is permanently banned." });
        }

        const nowUtc = new Date();
        const todayStr = nowUtc.toISOString().split('T')[0];

        const isRestoration = Boolean(coupon.used && coupon.student_name && coupon.redeemed_by && email && email.trim().toLowerCase() === coupon.redeemed_by.toLowerCase());
        
        if (coupon.used && (!email || email.trim().toLowerCase() !== (coupon.redeemed_by || '').toLowerCase())) {
            return res.status(400).json({ success: false, message: "This coupon code has already been redeemed by another account." });
        }

        const rawName = studentName || student_name;
        const resolvedStudentName = isRestoration ? coupon.student_name : (rawName ? rawName.trim().toUpperCase() : (email ? email.trim().split('@')[0].toUpperCase() : 'STUDENT'));
        const resolvedEmail = isRestoration ? coupon.redeemed_by : (email ? email.trim().toLowerCase() : null);
        const rawPhone = contact || whatsapp;
        const resolvedContact = isRestoration ? coupon.whatsapp : (rawPhone ? rawPhone.trim() : "+233000000000");

        if (coupon.exp_date && coupon.exp_date !== "Not yet" && coupon.exp_date < todayStr) {
            await pool.query('UPDATE coupons SET banned = TRUE, used = TRUE WHERE id = $1', [coupon.id]);
            return res.status(400).json({ success: false, message: "This coupon code has expired and is now banned." });
        }

        let calculatedExpDate = coupon.exp_date;
        if (!isRestoration || calculatedExpDate === "Not yet" || !calculatedExpDate) {
            const expDate = new Date(nowUtc);
            const productType = coupon.product_type || "Monthly";
            if (productType.includes("Monthly") || productType.includes("Paystack")) {
                expDate.setUTCMonth(expDate.getUTCMonth() + 1);
            } else if (productType.includes("Half-Yearly")) {
                expDate.setUTCMonth(expDate.getUTCMonth() + 6);
            } else if (productType.includes("Yearly")) {
                expDate.setUTCFullYear(expDate.getUTCFullYear() + 1);
            } else {
                expDate.setUTCMonth(expDate.getUTCMonth() + 1);
            }
            calculatedExpDate = expDate.toISOString().split('T')[0];
        }

        const inceptionToUse = (isRestoration && coupon.inception_date && coupon.inception_date !== "Not yet") ? coupon.inception_date : todayStr;
        const resolvedSchoolCode = (rawSchoolCode || coupon.school_code || "ONLINE-DIRECT").trim().toUpperCase();

        if (!isValidSchoolCodeFormat(resolvedSchoolCode)) {
            return res.status(400).json({ success: false, message: "Invalid school code format." });
        }

        if (!isRestoration) {
            await pool.query(
                `DELETE FROM students WHERE UPPER(TRIM(product_code)) = $1 AND UPPER(TRIM(school_code)) = $2`,
                [cleanProductCode, resolvedSchoolCode]
            );

            const studentId = 'std_' + Math.random().toString(36).substring(2, 9);
            await pool.query(
                `INSERT INTO students (
                    id, name, email, parent_whatsapp, school_code, product_code, status,
                    active_play_time_seconds, subject_times, activities_completed, average_score, challenges, joined_at
                 ) VALUES ($1, $2, $3, $4, $5, $6, 'Active', 0, '{}'::jsonb, 0, 0, '[]'::jsonb, CURRENT_TIMESTAMP)`,
                [studentId, resolvedStudentName, resolvedEmail, resolvedContact, resolvedSchoolCode, cleanProductCode]
            );
        } else {
            await pool.query(
                `UPDATE students SET 
                    name = $1, 
                    email = $2, 
                    parent_whatsapp = $3, 
                    status = 'Active' 
                 WHERE UPPER(TRIM(product_code)) = $4 AND UPPER(TRIM(school_code)) = $5`,
                [resolvedStudentName, resolvedEmail, resolvedContact, cleanProductCode, resolvedSchoolCode]
            );
        }

        await pool.query(
            `UPDATE coupons SET used = TRUE, banned = FALSE, inception_date = $1, exp_date = $2, redeemed_by = $3, student_name = $4, whatsapp = $5 WHERE id = $6`,
            [inceptionToUse, calculatedExpDate, resolvedEmail, resolvedStudentName, resolvedContact, coupon.id]
        );

        const sessionToken = jwt.sign(
            { productCode: cleanProductCode, studentName: resolvedStudentName.toUpperCase(), schoolCode: resolvedSchoolCode.toUpperCase() },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        const actor = `${resolvedStudentName} (${resolvedEmail || 'Student'})`;
        logAuditActivity("COUPON_VERIFIED", { productCode: cleanProductCode, email: resolvedEmail }, clientIp, actor);

        res.json({ 
            success: true, 
            active: true, 
            expiryDate: calculatedExpDate, 
            sessionToken: sessionToken,
            studentName: resolvedStudentName.toUpperCase(),
            message: isRestoration ? "Account successfully restored with original details!" : "Coupon verified successfully!" 
        });
    } catch (error) {
        console.error("Error verifying coupon:", error.message);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.post('/api/activate-subscription', async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    try {
        const { email, plan, planType, studentName, student_name, whatsapp, schoolCode, school_code, productCode, product_code, code } = req.body;

        const rawProductCode = productCode || product_code || code;
        if (!email || !rawProductCode) {
            return res.status(400).json({ success: false, message: "Email and Product Code are required for activation." });
        }

        const trimmedProductCode = rawProductCode.trim().toUpperCase();
        if (!isValidProductCodeFormat(trimmedProductCode)) {
            return res.status(400).json({ success: false, message: "Invalid product code format." });
        }

        const isPaystackRef = trimmedProductCode.startsWith('ELORM_');
        const couponRes = await pool.query('SELECT * FROM coupons WHERE UPPER(TRIM(product_code)) = $1', [trimmedProductCode]);

        if (couponRes.rows.length === 0 && !isPaystackRef) {
            return res.status(403).json({ success: false, message: "Unauthorized activation: Invalid or unverified product code reference." });
        }

        if (couponRes.rows.length > 0 && couponRes.rows[0].banned) {
            return res.status(400).json({ success: false, message: "This coupon code is permanently banned." });
        }

        const nowUtc = new Date();
        const todayStr = nowUtc.toISOString().split('T')[0];

        const existingCoupon = couponRes.rows[0] || {};
        const isRestoration = Boolean(existingCoupon.used && existingCoupon.student_name && existingCoupon.redeemed_by && email && email.trim().toLowerCase() === existingCoupon.redeemed_by.toLowerCase());

        if (existingCoupon.used && (!email || email.trim().toLowerCase() !== (existingCoupon.redeemed_by || '').toLowerCase())) {
            return res.status(400).json({ success: false, message: "This coupon code has already been redeemed by another account." });
        }

        let resolvedStudentName, resolvedEmail, resolvedWhatsapp;

        if (isRestoration) {
            resolvedStudentName = existingCoupon.student_name;
            resolvedEmail = existingCoupon.redeemed_by;
            resolvedWhatsapp = existingCoupon.whatsapp;
        } else {
            const rawName = studentName || student_name;
            resolvedStudentName = rawName ? rawName.trim().toUpperCase() : email.trim().split('@')[0].toUpperCase();
            resolvedEmail = email.trim().toLowerCase();
            resolvedWhatsapp = whatsapp ? whatsapp.trim() : "+233000000000";
        }

        let calculatedExpiryDate = existingCoupon.exp_date;
        if (!isRestoration || calculatedExpiryDate === "Not yet" || !calculatedExpiryDate) {
            const expDate = new Date(nowUtc);
            const lowerPlan = (planType || plan || '').toLowerCase();
            if (lowerPlan.includes('6month') || lowerPlan.includes('half')) {
                expDate.setUTCMonth(expDate.getUTCMonth() + 6);
            } else if (lowerPlan.includes('year') || lowerPlan.includes('yearly')) {
                expDate.setUTCFullYear(expDate.getUTCFullYear() + 1);
            } else {
                expDate.setUTCMonth(expDate.getUTCMonth() + 1);
            }
            calculatedExpiryDate = expDate.toISOString().split('T')[0];
        }

        const inceptionToUse = (isRestoration && existingCoupon.inception_date && existingCoupon.inception_date !== "Not yet") ? existingCoupon.inception_date : todayStr;
        const rawSchool = schoolCode || school_code || existingCoupon.school_code || "ONLINE-DIRECT";
        const targetSchoolCode = rawSchool.trim().toUpperCase();

        if (!isValidSchoolCodeFormat(targetSchoolCode)) {
            return res.status(400).json({ success: false, message: "Invalid school code format." });
        }

        const targetSchoolName = targetSchoolCode === 'ONLINE-DIRECT' ? "Online Direct" : (schoolCode || school_code || existingCoupon.school_name || "Online Direct");

        if (!isRestoration) {
            await pool.query(
                `DELETE FROM students WHERE UPPER(TRIM(product_code)) = $1 AND UPPER(TRIM(school_code)) = $2`,
                [trimmedProductCode, targetSchoolCode]
            );

            const studentId = 'std_' + Math.random().toString(36).substring(2, 9);
            await pool.query(
                `INSERT INTO students (
                    id, name, email, parent_whatsapp, school_code, product_code, status,
                    active_play_time_seconds, subject_times, activities_completed, average_score, challenges, joined_at
                 ) VALUES ($1, $2, $3, $4, $5, $6, 'Active', 0, '{}'::jsonb, 0, 0, '[]'::jsonb, CURRENT_TIMESTAMP)`,
                [studentId, resolvedStudentName, resolvedEmail, resolvedWhatsapp, targetSchoolCode, trimmedProductCode]
            );
        } else {
            await pool.query(
                `UPDATE students SET 
                    name = $1, 
                    email = $2, 
                    parent_whatsapp = $3, 
                    status = 'Active' 
                 WHERE UPPER(TRIM(product_code)) = $4 AND UPPER(TRIM(school_code)) = $5`,
                [resolvedStudentName, resolvedEmail, resolvedWhatsapp, trimmedProductCode, targetSchoolCode]
            );
        }

        if (couponRes.rows.length === 0) {
            await pool.query(
                `INSERT INTO coupons (school_name, school_code, product_type, product_code, payment_method, payment_status, used, banned, inception_date, exp_date, redeemed_by, student_name, whatsapp)
                 VALUES ($1, $2, $3, $4, 'paystack', 'approved', TRUE, FALSE, $5, $6, $7, $8, $9)`,
                [targetSchoolName, targetSchoolCode, plan || "Paystack Direct Pass", trimmedProductCode, inceptionToUse, calculatedExpiryDate, resolvedEmail, resolvedStudentName, resolvedWhatsapp]
            );
        } else {
            await pool.query(
                `UPDATE coupons SET used = TRUE, banned = FALSE, inception_date = $1, exp_date = $2, redeemed_by = $3, student_name = $4, whatsapp = $5 WHERE UPPER(TRIM(product_code)) = $6`,
                [inceptionToUse, calculatedExpiryDate, resolvedEmail, resolvedStudentName, resolvedWhatsapp, trimmedProductCode]
            );
        }

        const sessionToken = jwt.sign(
            { productCode: trimmedProductCode, studentName: resolvedStudentName.toUpperCase(), schoolCode: targetSchoolCode.toUpperCase() },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        const actor = `${resolvedStudentName} (${resolvedEmail})`;
        logAuditActivity("SUBSCRIPTION_ACTIVATED", { productCode: trimmedProductCode, email: resolvedEmail }, clientIp, actor);

        res.json({ 
            success: true, 
            message: isRestoration ? "Online subscription account successfully restored!" : "Online subscription successfully activated and stored!", 
            expiryDate: calculatedExpiryDate,
            studentName: resolvedStudentName.toUpperCase(),
            sessionToken: sessionToken 
        });
    } catch (error) {
        console.error("Error activating subscription:", error.message);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.post('/api/check-subscription', async (req, res) => {
    try {
        const { productCode, schoolCode } = req.body;
        if (!productCode) {
            return res.status(400).json({ success: false, status: 'inactive', message: "Product Code is mandatory. Email-only validation is disallowed." });
        }

        const cleanProductCode = productCode.trim().toUpperCase();
        if (!isValidProductCodeFormat(cleanProductCode)) {
            return res.json({ success: true, status: 'inactive', message: "Invalid product code format." });
        }

        let query = 'SELECT * FROM coupons WHERE UPPER(TRIM(product_code)) = $1';
        let params = [cleanProductCode];

        if (schoolCode) {
            const cleanSchoolCode = schoolCode.trim().toUpperCase();
            if (!isValidSchoolCodeFormat(cleanSchoolCode)) {
                return res.json({ success: true, status: 'inactive', message: "Invalid school code format." });
            }
            query += ' AND UPPER(TRIM(school_code)) = $2';
            params.push(cleanSchoolCode);
        }

        const couponRes = await pool.query(query, params);

        if (couponRes.rows.length === 0) {
            return res.json({ success: true, status: 'inactive' });
        }

        const coupon = couponRes.rows[0];

        if (!isValidSchoolCodeFormat(coupon.school_code) || !isValidProductCodeFormat(coupon.product_code)) {
            return res.json({ success: true, status: 'inactive', message: "Legacy or invalid code format in database." });
        }

        const todayStr = new Date().toISOString().split('T')[0];
        const isExpired = coupon.exp_date && coupon.exp_date !== "Not yet" && coupon.exp_date < todayStr;

        if (!coupon.used || isExpired || coupon.banned) {
            return res.json({ success: true, status: 'inactive' });
        }

        const expiresMs = coupon.exp_date ? new Date(coupon.exp_date).getTime() : Date.now() + (30 * 24 * 60 * 60 * 1000);

        res.json({
            success: true,
            status: 'active_subscription',
            email: coupon.redeemed_by,
            studentName: coupon.student_name || "",
            schoolCode: coupon.school_code || "ONLINE-DIRECT",
            productCode: coupon.product_code || "",
            whatsapp: coupon.whatsapp || "",
            plan: coupon.product_type || "Monthly Pass",
            expires: expiresMs
        });
    } catch (error) {
        console.error("Error checking subscription:", error.message);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.post('/api/update-subscription-info', async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    const actor = resolveActorFromReq(req, req.body.newEmail || 'User');
    try {
        const { originalEmail, newEmail, phone, studentName, student_name } = req.body;
        if (!originalEmail || !newEmail) {
            return res.status(400).json({ success: false, message: 'Original email and new email are required.' });
        }

        const cleanOrig = originalEmail.trim().toLowerCase();
        const cleanNew = newEmail.trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(cleanNew) || !emailRegex.test(cleanOrig)) {
            return res.status(400).json({ success: false, message: 'Invalid email format.' });
        }

        const rawName = studentName || student_name;
        await pool.query('UPDATE coupons SET redeemed_by = $1, student_name = COALESCE($2, student_name), whatsapp = COALESCE($3, whatsapp) WHERE LOWER(TRIM(redeemed_by)) = $4', [cleanNew, rawName ? rawName.trim() : null, phone ? phone.trim() : null, cleanOrig]);
        const studentUpdate = await pool.query('UPDATE students SET email = $1, name = COALESCE($2, name), parent_whatsapp = COALESCE($3, parent_whatsapp) WHERE LOWER(TRIM(email)) = $4', [cleanNew, rawName ? rawName.trim() : null, phone ? phone.trim() : null, cleanOrig]);

        if (studentUpdate.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Subscriber account not found in database.' });
        }

        logAuditActivity("SUBSCRIPTION_INFO_UPDATED", { originalEmail: cleanOrig, newEmail: cleanNew }, clientIp, actor);

        res.json({ success: true, message: 'Account details updated successfully.' });
    } catch (error) {
        console.error("Error updating subscription info:", error.message);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.post('/api/coupons/cleanup', authenticateToken, async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
    try {
        const todayStr = new Date().toISOString().split('T')[0];
        await pool.query("UPDATE coupons SET banned = TRUE WHERE used = TRUE AND exp_date != 'Not yet' AND exp_date < $1", [todayStr]);
        
        logAuditActivity("COUPON_EXPIRATION_CLEANUP", { status: 'Executed' }, clientIp, 'System Cron');
        
        res.json({ success: true, message: "Coupons expiration check and ban enforcement executed." });
    } catch (error) {
        console.error("Error cleaning up coupons:", error.message);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.get('/api/audit-logs', authenticateToken, async (req, res) => {
    try {
        const { startDate, endDate, isExport } = req.query;
        let query = 'SELECT action, details, timestamp, ip_address, actor FROM audit_logs';
        let conditions = [];
        let params = [];
        let paramIdx = 1;

        if (startDate) {
            conditions.push(`timestamp >= CAST($${paramIdx++} AS TIMESTAMP)`);
            params.push(`${startDate} 00:00:00`);
        }
        if (endDate) {
            conditions.push(`timestamp <= CAST($${paramIdx++} AS TIMESTAMP)`);
            params.push(`${endDate} 23:59:59`);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY timestamp DESC';

        if (isExport !== 'true') {
            query += ' LIMIT 100';
        }

        const result = await pool.query(query, params);
        res.json({ success: true, logs: result.rows });
    } catch (error) {
        console.error("Error fetching audit logs:", error);
        res.json({ success: false, logs: [] });
    }
});

app.get('/api/students', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                c.product_code AS "productCode",
                c.school_code AS "schoolCode",
                COALESCE(c.student_name, s.name, 'STUDENT') AS name,
                COALESCE(c.redeemed_by, s.email, '') AS email,
                COALESCE(c.whatsapp, s.parent_whatsapp, '+233000000000') AS "parentWhatsapp",
                COALESCE(s.id, 'std_' || SUBSTRING(MD5(c.product_code || c.school_code) FROM 1 FOR 8)) AS id,
                CASE WHEN c.banned THEN 'Banned' WHEN c.used THEN 'Active' ELSE 'Inactive' END AS status,
                COALESCE(s.user_type, 'student') AS "userType",
                COALESCE(s.whatsapp_enabled, TRUE) AS "whatsappEnabled",
                COALESCE(s.active_play_time_seconds, 0) AS "activePlayTimeSeconds",
                COALESCE(s.subject_times, '{}'::jsonb) AS "subjectTimes",
                COALESCE(s.activities_completed, 0) AS "activitiesCompleted",
                COALESCE(s.average_score, 0) AS "averageScore",
                COALESCE(s.challenges, '[]'::jsonb) AS "challenges",
                COALESCE(s.joined_at, c.created_at, CURRENT_TIMESTAMP) AS "joinedAt"
            FROM coupons c
            LEFT JOIN students s 
                ON UPPER(TRIM(s.product_code)) = UPPER(TRIM(c.product_code))
               AND UPPER(TRIM(s.school_code)) = UPPER(TRIM(c.school_code))
            WHERE c.used = TRUE
            ORDER BY c.id DESC
        `);

        const sessionsRes = await pool.query('SELECT * FROM active_sessions');
        const formattedStudents = result.rows.map(s => ({
            id: s.id,
            name: s.name,
            email: s.email,
            parentWhatsapp: s.parentWhatsapp,
            schoolCode: s.schoolCode,
            productCode: s.productCode,
            status: s.status,
            userType: s.userType,
            whatsappEnabled: s.whatsappEnabled,
            metrics: {
                activePlayTimeSeconds: parseInt(s.activePlayTimeSeconds, 10) || 0,
                subjectTimes: s.subjectTimes,
                activitiesCompleted: parseInt(s.activitiesCompleted, 10) || 0,
                averageScore: parseFloat(s.averageScore) || 0,
                challenges: s.challenges
            },
            joinedAt: s.joinedAt
        }));
        res.json({ success: true, students: formattedStudents, activeSessions: sessionsRes.rows });
    } catch (error) {
        console.error("Error fetching students:", error.message);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

// SESSION LOGIN ROUTE: Dispatches entry notification to parent when student enters arena
app.post('/api/session/login-alert', async (req, res) => {
    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch(e) { body = {}; }
        }
        const { studentId, sessionData } = body;
        const result = await handleSessionLogin(studentId, sessionData);
        res.json(result);
    } catch (error) {
        console.error("Error handling session login alert:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// SILENT BACKGROUND SYNC ROUTE: Records telemetry into PostgreSQL without triggering WhatsApp
app.post('/api/telemetry/sync', async (req, res) => {
    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch(e) { body = {}; }
        }
        const { studentId, sessionData } = body;
        if (!studentId || !sessionData) {
            return res.status(400).json({ success: false, error: "Missing studentId or sessionData payload" });
        }

        const result = await handleSilentSync(studentId, sessionData);
        res.json(result);
    } catch (error) {
        console.error("Error handling silent telemetry sync:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// NAVIGATION / UNLOAD EXIT ROUTE: Strictly syncs metrics silently without sending premature WhatsApp messages
app.post('/api/telemetry/exit', async (req, res) => {
    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch(e) { body = {}; }
        }

        const { studentId, sessionData } = body;
        if (!studentId || !sessionData) {
            return res.status(400).json({ success: false, error: "Missing studentId or sessionData payload" });
        }

        // Only sync latest data into PostgreSQL; 15-minute watchdog handles the exit report
        const result = await handleSilentSync(studentId, sessionData);
        res.json(result);
    } catch (error) {
        console.error("Error handling telemetry exit sync:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Legacy backward-compatible route mapping to silent sync
app.post('/api/sessions/end', async (req, res) => {
    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch(e) { body = {}; }
        }
        const { studentId, sessionData } = body;
        if (!studentId || !sessionData) {
            return res.status(400).json({ success: false, error: "Missing studentId or sessionData payload" });
        }

        const result = await handleSilentSync(studentId, sessionData);
        res.json(result);
    } catch (error) {
        console.error("Error handling session end:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/whatsapp/send', async (req, res) => {
    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch(e) { body = {}; }
        }
        const { studentId } = body;
        if (!studentId) {
            return res.status(400).json({ success: false, message: "Missing studentId." });
        }

        const studentRes = await pool.query(
            `SELECT 
                s.*,
                COALESCE(c.student_name, s.name) AS display_name,
                COALESCE(c.whatsapp, s.parent_whatsapp) AS display_whatsapp,
                c.exp_date AS coupon_expiry
             FROM students s
             LEFT JOIN coupons c 
                ON UPPER(TRIM(c.product_code)) = UPPER(TRIM(s.product_code)) 
               AND UPPER(TRIM(c.school_code)) = UPPER(TRIM(s.school_code))
             WHERE s.id = $1 
                OR UPPER(TRIM(s.product_code)) = UPPER(TRIM($1))
             LIMIT 1`, 
            [studentId]
        );

        if (studentRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Student record not found." });
        }

        const s = studentRes.rows[0];
        let rawChallenges = s.challenges || [];
        if (typeof rawChallenges === 'string') {
            try { rawChallenges = JSON.parse(rawChallenges); } catch(e) { rawChallenges = []; }
        }

        const student = {
            id: s.id,
            name: s.display_name || s.name,
            email: s.email,
            parentWhatsapp: s.display_whatsapp || s.parent_whatsapp,
            schoolCode: s.school_code,
            productCode: s.product_code,
            expiryDate: s.coupon_expiry || null
        };

        const metrics = {
            activePlayTimeSeconds: s.active_play_time_seconds,
            subjectTimes: s.subject_times,
            activitiesCompleted: s.activities_completed,
            averageScore: parseFloat(s.average_score),
            challenges: rawChallenges
        };

        if (!student.parentWhatsapp || student.parentWhatsapp === "+233000000000") {
            return res.status(400).json({ success: false, message: "No valid parent WhatsApp number configured for this student." });
        }

        const result = await sendWhatsAppNotification(student, metrics);

        if (result.success) {
            await pool.query(
                `UPDATE students SET 
                    active_play_time_seconds = 0,
                    activities_completed = 0,
                    average_score = 0,
                    challenges = '[]'::jsonb,
                    subject_times = '{}'::jsonb
                 WHERE id = $1`,
                [s.id]
            );
            res.json({ success: true, message: `Report sent to ${student.name}'s parent and session timer zeroed!` });
        } else {
            res.status(500).json({ success: false, message: result.message || result.error || "Failed to dispatch WhatsApp message." });
        }
    } catch (error) {
        console.error("Error in /api/whatsapp/send:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`[Bright & Bold Monitor Backend] Running securely on PostgreSQL on port ${PORT}`);
});