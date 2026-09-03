// File: whatsappService.js | System: School Monitor WhatsApp Notification Hub (Pairing Code Mode + PostgreSQL Auth Persistence)
const { default: makeWASocket, DisconnectReason, initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const pino = require('pino');
const pool = require('./db');

let sock = null;
let isConnected = false;
let pairingRequested = false;

// 30 Curated Parental Guidance Tips & Insights
const PARENTAL_TIPS = [
    '"Children perform better when their effort is noticed and rewarded." — Jean Piaget',
    '"Encourage problem-solving rather than just seeking the right answer." — Jerome Bruner',
    '"Children are not vessels to be filled, but lamps to be lit." — Plutarch',
    '"Praise the process and effort, not just innate intelligence." — Carol Dweck',
    '"Rebuke with purpose and guide with patience." — Ken Sab',
    '"Play and hands-on discovery are the highest forms of learning." — Albert Einstein',
    '"Consistent daily habits beat occasional intense study sessions." — Educational Insight',
    '"A child who asks questions is actively building understanding." — Lev Vygotsky',
    '"Mistakes are proof that a child is trying and learning." — John Dewey',
    '"Correct a child in private, praise a child in public." — Parenting Principle',
    '"Curiosity is the engine of intellectual growth; protect it." — Sir Ken Robinson',
    '"Listen to your child\'s explanations before offering corrections." — Educational Wisdom',
    '"Small, steady progress every day leads to massive long-term mastery." — Learning Insight',
    '"Discipline teaches self-control; anger only teaches fear." — Child Development Insight',
    '"A child who feels safe to fail will eventually succeed." — Parenting Insight',
    '"Help children learn how to think, not just what to think." — Margaret Mead',
    '"Routine and structure give children the freedom to focus." — Maria Montessori',
    '"When a child struggles, guide them to the next small step rather than doing it for them." — Lev Vygotsky',
    '"Reading with your child builds vocabulary faster than any textbook." — Literacy Insight',
    '"Celebrate persistence over perfection." — Growth Mindset Principle',
    '"Children learn more from what parents model than what parents lecture." — James Baldwin',
    '"A quiet study space with zero distractions multiplies focus." — Study Habit Tip',
    '"Encourage your child to teach you what they learned today." — Feynman Technique',
    '"Patience with a slow learner builds lifelong confidence." — Pedagogical Insight',
    '"Ask open questions: \'How did you solve that?\' builds critical thinking." — STEM Learning Tip',
    '"Praise courage when they attempt a hard math or science challenge." — Academic Coaching Tip',
    '"Rest and adequate sleep are just as critical as study hours for memory retention." — Cognitive Science',
    '"Affirm their identity as capable learners every single day." — Parental Affirmation',
    '"A parent\'s belief in a child becomes the child\'s inner voice." — Developmental Insight',
    '"Consistency in guidance produces stability in character and academics." — Educational Principle'
];

// Anti-Spam Queue & Safeguard State
const messageQueue = [];
let isProcessingQueue = false;
const loginCooldowns = new Map();
const LOGIN_COOLDOWN_MS = 15 * 60 * 1000;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getRandomParentTip() {
    const randomIdx = Math.floor(Math.random() * PARENTAL_TIPS.length);
    return PARENTAL_TIPS[randomIdx];
}

const ADMIN_PHONE_NUMBER = process.env.ADMIN_PHONE_NUMBER || '233201351763';

function formatToJid(phone) {
    if (!phone) return null;
    let clean = phone.toString().replace(/[^0-9]/g, '');
    if (clean.startsWith('0') && clean.length === 10) {
        clean = '233' + clean.slice(1);
    }
    if (clean.length < 9 || clean === '233000000000' || /^0+$/.test(clean)) {
        return null;
    }
    return `${clean}@s.whatsapp.net`;
}

function formatStudyTime(secs) {
    const s = parseInt(secs, 10) || 0;
    if (s < 60) return `${s}s`;
    const mins = Math.floor(s / 60);
    const remSecs = s % 60;
    if (mins < 60) {
        return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
    }
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours}h ${remMins}m`;
}

function formatPossessiveName(name) {
    if (!name) return "Student's";
    const clean = name.trim().toUpperCase();
    return clean.endsWith('S') ? `${clean}'` : `${clean}'s`;
}

function evaluateBehaviorStatus(m = {}) {
    const totalSecs = parseInt(m.activePlayTimeSeconds, 10) || 0;
    const activities = parseInt(m.activitiesCompleted, 10) || (Array.isArray(m.challenges) ? m.challenges.length : 0);
    const avgScore = parseFloat(m.averageScore) || 0;

    if (totalSecs < 30 && activities === 0) return "Initializing";
    if (m.isIdle) return "Idle / Disengaged";
    if (avgScore < 50 && totalSecs < 300 && activities > 0) return "Rushing / Skimming";
    if (avgScore < 60 && totalSecs >= 600) return "Diligent / Struggling";
    return "Focused & Progressing";
}

function formatExpiryNotice(expDateStr) {
    if (!expDateStr || expDateStr === "Not yet") {
        return `*Subscription Status:* Active`;
    }

    const targetDate = new Date(expDateStr);
    if (isNaN(targetDate.getTime())) {
        return `*Subscription Status:* Active`;
    }

    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const expMidnight = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());

    const diffDays = Math.round((expMidnight - todayMidnight) / (1000 * 60 * 60 * 24));

    const formattedDate = targetDate.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });

    if (diffDays <= 0) {
        return `*Subscription expires by close of today, please renew.*`;
    } else if (diffDays === 1) {
        return `*Subscription expires in 1 day, please renew.*`;
    } else if (diffDays === 2) {
        return `*Subscription expires in 2 days time, please renew.*`;
    } else if (diffDays === 3) {
        return `*Subscription expires in 3 days time, please renew.*`;
    } else {
        return `*Subscription expires on ${formattedDate}.*`;
    }
}

async function processMessageQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    while (messageQueue.length > 0) {
        const currentTask = messageQueue.shift();
        const { recipientJid, messageBody, logMessage, resolve } = currentTask;

        try {
            if (!sock || !isConnected) {
                console.warn(`[WhatsApp Notice] Bot not connected. Message for ${recipientJid} skipped.`);
                resolve({ success: false, message: "WhatsApp client is not connected." });
                continue;
            }

            const jitterMs = Math.floor(Math.random() * 3000) + 3000;
            await sleep(jitterMs);

            await sock.sendPresenceUpdate('composing', recipientJid);
            const typingDuration = Math.floor(Math.random() * 1500) + 1500;
            await sleep(typingDuration);
            await sock.sendPresenceUpdate('paused', recipientJid);

            await sock.sendMessage(recipientJid, { text: messageBody });
            if (logMessage) {
                console.log(logMessage);
            }

            resolve({ success: true, message: "Message sent successfully." });
        } catch (err) {
            console.error("[WhatsApp Queue Dispatch Error]:", err.message);
            resolve({ success: false, error: err.message });
        }
    }

    isProcessingQueue = false;
}

function enqueueOutboundNotification(recipientJid, messageBody, logMessage) {
    return new Promise((resolve) => {
        messageQueue.push({ recipientJid, messageBody, logMessage, resolve });
        processMessageQueue();
    });
}

// PostgreSQL-Backed Multi-Auth State Handler for Baileys
async function usePostgresAuthState() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS baileys_auth_store (
            id VARCHAR(255) PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

    const readData = async (key) => {
        try {
            const res = await pool.query('SELECT value FROM baileys_auth_store WHERE id = $1', [key]);
            if (res.rows.length > 0) {
                return JSON.parse(res.rows[0].value, BufferJSON.reviver);
            }
            return null;
        } catch (err) {
            console.error(`[Baileys PG Auth] Read Error for key "${key}":`, err.message);
            return null;
        }
    };

    const writeData = async (key, value) => {
        try {
            const serialized = JSON.stringify(value, BufferJSON.replacer);
            await pool.query(`
                INSERT INTO baileys_auth_store (id, value, updated_at) 
                VALUES ($1, $2, CURRENT_TIMESTAMP)
                ON CONFLICT (id) DO UPDATE 
                SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
            `, [key, serialized]);
        } catch (err) {
            console.error(`[Baileys PG Auth] Write Error for key "${key}":`, err.message);
        }
    };

    const removeData = async (key) => {
        try {
            await pool.query('DELETE FROM baileys_auth_store WHERE id = $1', [key]);
        } catch (err) {
            console.error(`[Baileys PG Auth] Delete Error for key "${key}":`, err.message);
        }
    };

    const credsData = await readData('creds');
    const creds = credsData || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                tasks.push(writeData(key, value));
                            } else {
                                tasks.push(removeData(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData('creds', creds)
    };
}

async function initWhatsApp() {
    const { state, saveCreds } = await usePostgresAuthState();

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        defaultQueryTimeoutMs: 60000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        const statusCode = lastDisconnect?.error?.output?.statusCode;

        if (connection === 'close') {
            isConnected = false;
            pairingRequested = false;
            console.log(`[WhatsApp] Connection closed (status: ${statusCode || 'unknown'}).`);

            // Case 1: WhatsApp requested immediate reconnect to complete pairing (Error 515 / restartRequired)
            if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
                console.log('⚡ [WhatsApp Handshake] Received pairing keys from phone! Reconnecting instantly to finalize link...');
                await saveCreds();
                setTimeout(initWhatsApp, 1500);
                return;
            }

            // Case 2: Code 401 (Unauthorized / Stale credentials)
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log('[WhatsApp] Stale session encountered (401). Purging old PostgreSQL credentials table...');
                try {
                    await pool.query('TRUNCATE TABLE baileys_auth_store;');
                } catch (e) {
                    console.error('Failed to clear table:', e.message);
                }
                console.log('[WhatsApp] Restarting clean session in 4 seconds...');
                setTimeout(initWhatsApp, 4000);
                return;
            }

            // Case 3: Other unexpected disconnects
            console.log('[WhatsApp] Reconnecting in 6 seconds...');
            setTimeout(initWhatsApp, 6000);

        } else if (connection === 'open') {
            isConnected = true;
            pairingRequested = false;
            console.log('🚀 [WhatsApp Bot Online] Successfully connected and authenticated via PostgreSQL!');
        }

        // Request pairing code if credentials are not yet registered
        if (!sock.authState.creds.registered && !pairingRequested && connection !== 'close') {
            pairingRequested = true;
            setTimeout(async () => {
                try {
                    if (ADMIN_PHONE_NUMBER && ADMIN_PHONE_NUMBER !== '233XXXXXXXXX') {
                        const cleanPhone = ADMIN_PHONE_NUMBER.replace(/[^0-9]/g, '');
                        const code = await sock.requestPairingCode(cleanPhone);
                        console.log('\n======================================================');
                        console.log(`📱 YOUR WHATSAPP PAIRING CODE IS:  ${code}`);
                        console.log('======================================================');
                        console.log('👉 Open WhatsApp on phone -> Linked Devices -> Link with phone number instead -> Enter this code.\n');
                    }
                } catch (err) {
                    console.error('Failed to request pairing code:', err.message);
                    pairingRequested = false;
                }
            }, 4000);
        }
    });
}

async function sendSessionLoginNotification(student) {
    try {
        const parentNumber = student.parentWhatsapp;
        if (!parentNumber || parentNumber === "+233000000000") {
            console.log(`[WhatsApp Skipped] No valid parent WhatsApp number registered for student: ${student.name}`);
            return { success: false, message: "No valid phone number." };
        }

        const recipientJid = formatToJid(parentNumber);
        if (!recipientJid) {
            console.log(`[WhatsApp Skipped] Malformed phone number: ${parentNumber}`);
            return { success: false, message: "Invalid phone number format." };
        }

        const studentIdentifier = student.id || student.username || student.name;
        const lastLoginTime = loginCooldowns.get(studentIdentifier);
        const now = Date.now();
        if (lastLoginTime && (now - lastLoginTime) < LOGIN_COOLDOWN_MS) {
            console.log(`[WhatsApp Login Cooldown] Entry alert for ${student.name} skipped (within 15m cooldown window).`);
            return { success: true, message: "Login alert skipped due to cooldown window." };
        }
        loginCooldowns.set(studentIdentifier, now);

        if (!sock || !isConnected) {
            console.warn(`[WhatsApp Notice] Bot not connected. Login alert for ${student.name} skipped.`);
            return { success: false, message: "WhatsApp client is not connected." };
        }

        const dateFormatted = new Date().toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });

        const timeString = new Date().toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit'
        });

        const messageBody = `🔔 *Bright & Bold Learning Notice*\n` +
            `https://www.elormacademy.com\n\n` +
            `*${student.name}* has entered the Bright & Bold online classroom.\n\n` +
            `📅 *Date:* ${dateFormatted}\n` +
            `⏰ *Login Time:* ${timeString}\n\n` +
            `You will receive a detailed performance summary once this study session concludes.`;

        const logMsg = `✅ [WhatsApp Login Sent] Entry alert successfully sent to ${student.name} (${parentNumber})`;
        return await enqueueOutboundNotification(recipientJid, messageBody, logMsg);

    } catch (error) {
        console.error("[WhatsApp Login Alert Error]:", error.message);
        return { success: false, error: error.message };
    }
}

async function sendWhatsAppNotification(student, metrics = {}) {
    try {
        const parentNumber = student.parentWhatsapp;
        if (!parentNumber || parentNumber === "+233000000000") {
            console.log(`[WhatsApp Skipped] No valid parent WhatsApp number registered for student: ${student.name}`);
            return { success: false, message: "No valid phone number." };
        }

        const recipientJid = formatToJid(parentNumber);
        if (!recipientJid) {
            console.log(`[WhatsApp Skipped] Malformed phone number: ${parentNumber}`);
            return { success: false, message: "Invalid phone number format." };
        }

        if (!sock || !isConnected) {
            console.warn(`[WhatsApp Notice] Bot not connected. Message for ${student.name} skipped.`);
            return { success: false, message: "WhatsApp client is not connected. Enter pairing code in terminal." };
        }

        let rawChallenges = metrics.challenges || [];
        if (typeof rawChallenges === 'string') {
            try { rawChallenges = JSON.parse(rawChallenges); } catch(e) { rawChallenges = []; }
        }

        const challengeSumSeconds = rawChallenges.reduce((sum, c) => sum + (parseInt(c.durationSeconds, 10) || 0), 0);
        const totalActiveSeconds = Math.max(challengeSumSeconds, parseInt(metrics.activePlayTimeSeconds, 10) || 0);
        const timeFormatted = formatStudyTime(totalActiveSeconds);

        let challengesText = "None - Practice makes perfect!";
        if (rawChallenges && rawChallenges.length > 0) {
            challengesText = rawChallenges.map(c => {
                const sub = c.subject ? `[${c.subject.charAt(0).toUpperCase() + c.subject.slice(1)}] ` : '';
                const top = c.topic || 'General Topic';
                const score = Math.round(parseFloat(c.percentage !== undefined ? c.percentage : (c.totalScore || 0)));
                const dur = formatStudyTime(c.durationSeconds || 0);
                return `${sub}${top} (${score}% - ${dur})`;
            }).join('\n• ');
            challengesText = '\n• ' + challengesText;
        }

        const behaviorStatus = evaluateBehaviorStatus({ ...metrics, challenges: rawChallenges, activePlayTimeSeconds: totalActiveSeconds });
        const randomTip = getRandomParentTip();
        const possessiveName = formatPossessiveName(student.name);
        const expiryNotice = formatExpiryNotice(student.expiryDate);

        const dateFormatted = new Date().toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });

        const messageBody = `📚 *Bright & Bold Learning Update*\n` +
            `https://www.elormacademy.com\n\n` +
            `*${possessiveName}* session progress report:\n\n` +
            `💡 *Parenting Wisdom:*\n_${randomTip}_\n\n` +
            `📅 *Date:* ${dateFormatted}\n` +
            `⏱️ *Active Study Time:* ${timeFormatted}\n` +
            `📊 *Average Score:* ${Math.round(parseFloat(metrics.averageScore) || 0)}%\n` +
            `🎯 *Behavior:* ${behaviorStatus}\n` +
            `📝 *Topics Attempted:* ${challengesText}\n\n` +
            `${expiryNotice}`;

        const logMsg = `✅ [WhatsApp Sent] Report successfully sent to ${student.name} (${parentNumber})`;
        return await enqueueOutboundNotification(recipientJid, messageBody, logMsg);

    } catch (error) {
        console.error("[WhatsApp Service Error]:", error.message);
        return { success: false, error: error.message };
    }
}

initWhatsApp().catch(err => console.error('[WhatsApp Init Error]:', err));

module.exports = { 
    sendWhatsAppNotification, 
    sendSessionLoginNotification, 
    initWhatsApp 
};