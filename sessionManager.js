// File: sessionManager.js | System: School Monitor Backend (Strict Two-Message Lifecycle Engine)
const pool = require('./db');
const { sendWhatsAppNotification, sendSessionLoginNotification } = require('./whatsappService');

const RECENT_EXIT_DISPATCHES = new Map();
const RECENT_LOGIN_DISPATCHES = new Map();

async function ensureDatabaseSchema() {
    try {
        await pool.query(`
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
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS subject_times JSONB DEFAULT '{}'::jsonb,
            ADD COLUMN IF NOT EXISTS challenges JSONB DEFAULT '[]'::jsonb,
            ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        `);
    } catch (error) {
        console.error("[Schema Migration Error]:", error.message);
    }
}

function startTtlCleanupJob() {
    setInterval(async () => {
        try {
            // Strictly check for Active students whose inactivity reached 15 minutes with actual study data
            const query = `
                SELECT s.*, c.exp_date AS coupon_expiry 
                FROM students s
                LEFT JOIN coupons c 
                  ON UPPER(TRIM(c.product_code)) = UPPER(TRIM(s.product_code))
                 AND UPPER(TRIM(c.school_code)) = UPPER(TRIM(s.school_code))
                WHERE s.status = 'Active'
                  AND s.last_active_at <= NOW() - INTERVAL '15 minutes'
                  AND (s.active_play_time_seconds >= 5 OR jsonb_array_length(s.challenges) > 0)
            `;

            const expiredSessions = await pool.query(query);

            for (const student of expiredSessions.rows) {
                const rawProduct = (student.product_code || '').trim().toUpperCase();
                const schoolCode = (student.school_code || 'ONLINE-DIRECT').trim().toUpperCase();
                const sessionKey = `${schoolCode}_${rawProduct}`;

                const now = Date.now();
                const lastSentTime = RECENT_EXIT_DISPATCHES.get(rawProduct) || 0;
                const FIVE_MINUTES_MS = 5 * 60 * 1000;

                if (now - lastSentTime < FIVE_MINUTES_MS) {
                    continue;
                }

                if (student.parent_whatsapp && student.parent_whatsapp !== "+233000000000") {
                    let rawChallenges = student.challenges || [];
                    if (typeof rawChallenges === 'string') {
                        try { rawChallenges = JSON.parse(rawChallenges); } catch (e) { rawChallenges = []; }
                    }

                    const formattedForWhatsApp = {
                        id: student.id,
                        name: student.name,
                        parentWhatsapp: student.parent_whatsapp,
                        expiryDate: student.coupon_expiry || null
                    };

                    const metricsToDispatch = {
                        activePlayTimeSeconds: student.active_play_time_seconds,
                        subjectTimes: student.subject_times || {},
                        activitiesCompleted: student.activities_completed,
                        averageScore: parseFloat(student.average_score) || 0,
                        challenges: rawChallenges
                    };

                    RECENT_EXIT_DISPATCHES.set(rawProduct, now);
                    RECENT_LOGIN_DISPATCHES.delete(sessionKey); // Unlock login cooldown for next fresh session

                    // Message 2: 15-minute inactivity report
                    await sendWhatsAppNotification(formattedForWhatsApp, metricsToDispatch);
                    console.log(`✅ [15m Watchdog] Final exit report dispatched for: ${student.name}`);

                    // Permanently close the session and reset all metrics
                    await pool.query(
                        `UPDATE students SET 
                            status = 'Completed',
                            active_play_time_seconds = 0,
                            activities_completed = 0,
                            average_score = 0,
                            challenges = '[]'::jsonb,
                            subject_times = '{}'::jsonb,
                            last_active_at = CURRENT_TIMESTAMP
                         WHERE id = $1`,
                        [student.id]
                    );
                    console.log(`🔄 [Session Completed] Reset metrics for student ID: ${student.id}`);
                }
            }
        } catch (err) {
            console.error("[Database Watchdog Error]:", err.message);
        }
    }, 15000);
}

async function handleSessionLogin(studentIdentifier, sessionData = {}) {
    try {
        const rawProduct = sessionData.productCode || studentIdentifier || '';
        const cleanProductCode = rawProduct.trim().toUpperCase();
        const incomingSchoolCode = (sessionData.schoolCode || 'ONLINE-DIRECT').trim().toUpperCase();
        const sessionKey = `${incomingSchoolCode}_${cleanProductCode}`;

        // 6-hour persistent server lock while session is active
        const now = Date.now();
        const lastSentTime = RECENT_LOGIN_DISPATCHES.get(sessionKey) || 0;
        const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

        if (now - lastSentTime < SIX_HOURS_MS) {
            console.log(`[Duplicate Login Suppressed] Alert already sent for active session ${sessionKey}.`);
            return { success: true, message: "Duplicate login alert suppressed." };
        }

        const couponRes = await pool.query(
            'SELECT student_name, redeemed_by, whatsapp, school_code, exp_date FROM coupons WHERE UPPER(TRIM(product_code)) = $1 AND UPPER(TRIM(school_code)) = $2',
            [cleanProductCode, incomingSchoolCode]
        );
        const coupon = couponRes.rows[0] || {};

        const resolvedName = (coupon.student_name || sessionData.studentName || 'STUDENT').trim().toUpperCase();
        const resolvedPhone = coupon.whatsapp || sessionData.parentWhatsapp || '+233000000000';

        let studentRes = await pool.query(
            `SELECT id, name, parent_whatsapp, school_code, product_code 
             FROM students 
             WHERE UPPER(TRIM(product_code)) = $1 AND UPPER(TRIM(school_code)) = $2
             LIMIT 1`,
            [cleanProductCode, incomingSchoolCode]
        );

        let student = studentRes.rows[0];

        if (!student) {
            const generatedId = 'std_' + Math.random().toString(36).substring(2, 9);
            const fallbackEmail = (coupon.redeemed_by || sessionData.email || `${generatedId}@elormacademy.com`).trim().toLowerCase();

            const insertRes = await pool.query(
                `INSERT INTO students (
                    id, name, email, parent_whatsapp, school_code, product_code, 
                    status, active_play_time_seconds, subject_times, activities_completed, 
                    average_score, challenges, joined_at, last_active_at
                ) VALUES ($1, $2, $3, $4, $5, $6, 'Active', 0, '{}'::jsonb, 0, 0, '[]'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                RETURNING id, parent_whatsapp, name, school_code, product_code`,
                [generatedId, resolvedName, fallbackEmail, resolvedPhone, incomingSchoolCode, cleanProductCode]
            );
            student = insertRes.rows[0];
        } else {
            await pool.query(
                `UPDATE students SET status = 'Active', last_active_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [student.id]
            );
        }

        if (student && student.parent_whatsapp && student.parent_whatsapp !== "+233000000000") {
            const formattedForWhatsApp = {
                id: student.id,
                name: student.name,
                parentWhatsapp: student.parent_whatsapp,
                expiryDate: coupon.exp_date || null
            };
            RECENT_LOGIN_DISPATCHES.set(sessionKey, now);

            // Message 1: Login entry alert
            await sendSessionLoginNotification(formattedForWhatsApp);
            console.log(`✅ [Login Alert Sent] Message dispatched to parent for: ${student.name}`);
        }

        return { success: true, message: "Login alert dispatched." };
    } catch (error) {
        console.error("[Session Login Error]:", error.message);
        throw error;
    }
}

async function handleSilentSync(studentId, sessionData) {
    try {
        const incomingMetrics = sessionData.metrics || {};
        const incomingSeconds = Math.max(0, parseInt(incomingMetrics.activePlayTimeSeconds, 10) || 0);
        const incomingActivities = Math.max(0, parseInt(incomingMetrics.activitiesCompleted, 10) || 0);
        const incomingScore = incomingMetrics.averageScore !== undefined && incomingMetrics.averageScore !== null 
            ? parseFloat(incomingMetrics.averageScore) 
            : null;
        const incomingSubjectTimes = incomingMetrics.subjectTimes || {};
        const rawChallenges = Array.isArray(incomingMetrics.challenges) ? incomingMetrics.challenges : [];

        const validChallenges = rawChallenges.filter(c => {
            const hasScore = c.score !== undefined && c.score !== null;
            const hasDuration = (parseInt(c.durationSeconds, 10) || 0) > 0;
            return hasScore || hasDuration;
        });

        const rawProduct = sessionData.productCode || studentId || '';
        const cleanProductCode = rawProduct.trim().toUpperCase();
        const incomingSchoolCode = (sessionData.schoolCode || 'ONLINE-DIRECT').trim().toUpperCase();

        const couponRes = await pool.query(
            'SELECT student_name, redeemed_by, whatsapp, school_code, exp_date FROM coupons WHERE UPPER(TRIM(product_code)) = $1 AND UPPER(TRIM(school_code)) = $2',
            [cleanProductCode, incomingSchoolCode]
        );
        const coupon = couponRes.rows[0] || {};
        
        const resolvedName = (coupon.student_name || sessionData.studentName || 'STUDENT').trim().toUpperCase();
        const resolvedEmail = (coupon.redeemed_by || sessionData.email || '').trim().toLowerCase();
        const resolvedPhone = coupon.whatsapp || sessionData.parentWhatsapp || '+233000000000';
        const resolvedSchool = incomingSchoolCode || coupon.school_code || 'ONLINE-DIRECT';

        let studentRes = await pool.query(
            `SELECT id, name, email, parent_whatsapp, school_code, product_code, status,
                    active_play_time_seconds, activities_completed, average_score, subject_times, challenges 
             FROM students 
             WHERE UPPER(TRIM(product_code)) = $1 AND UPPER(TRIM(school_code)) = $2
             LIMIT 1`,
            [cleanProductCode, resolvedSchool]
        );

        let student;

        if (studentRes.rows.length === 0) {
            const generatedId = 'std_' + Math.random().toString(36).substring(2, 9);
            const fallbackEmail = resolvedEmail || `${generatedId}@elormacademy.com`;

            const initialChallenges = validChallenges.map(c => {
                const sScore = Math.min(100, Math.max(0, c.score !== undefined ? parseFloat(c.score) : (incomingScore !== null ? incomingScore : 0)));
                const sDur = Math.max(1, parseInt(c.durationSeconds, 10) || 15);
                const attempts = Math.max(1, parseInt(c.attempts, 10) || 1);
                const totalScore = sScore * attempts;
                return {
                    subject: c.subject || 'general',
                    topic: c.topic || 'General Topic',
                    activityType: c.activityType || 'quizzes',
                    totalScore: totalScore,
                    percentage: sScore,
                    durationSeconds: sDur,
                    attempts: attempts,
                    lastAttemptId: c.attemptId || null
                };
            });

            const initialActivities = initialChallenges.length > 0 
                ? initialChallenges.reduce((sum, c) => sum + (parseInt(c.attempts, 10) || 1), 0)
                : incomingActivities;

            const initialAvgScore = initialChallenges.length > 0 
                ? Math.min(100, Math.max(0, Math.round(initialChallenges.reduce((sum, c) => sum + (parseFloat(c.totalScore) || 0), 0) / initialActivities)))
                : (incomingScore !== null ? Math.min(100, Math.max(0, Math.round(incomingScore))) : 0);

            const challengeSecondsSum = initialChallenges.reduce((sum, c) => sum + c.durationSeconds, 0);
            const finalSeconds = Math.max(incomingSeconds, challengeSecondsSum);

            const insertRes = await pool.query(
                `INSERT INTO students (
                    id, name, email, parent_whatsapp, school_code, product_code, 
                    status, active_play_time_seconds, subject_times, activities_completed, 
                    average_score, challenges, joined_at, last_active_at
                ) VALUES ($1, $2, $3, $4, $5, $6, 'Active', $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                RETURNING id, parent_whatsapp, name, school_code, product_code`,
                [
                    generatedId, resolvedName, fallbackEmail, resolvedPhone, resolvedSchool, cleanProductCode, 
                    finalSeconds, JSON.stringify(incomingSubjectTimes), initialActivities, 
                    initialAvgScore, JSON.stringify(initialChallenges)
                ]
            );
            student = insertRes.rows[0];
        } else {
            const currentStudent = studentRes.rows[0];
            const currentStudentId = currentStudent.id;
            const currentStatus = currentStudent.status;

            const isIdle = Boolean(incomingMetrics.isIdle);
            const isHidden = Boolean(sessionData.isTabHidden);

            // Block completed sessions from reviving on passive background idle heartbeats
            if (currentStatus === 'Completed' && (isIdle || isHidden || (incomingSeconds === 0 && validChallenges.length === 0))) {
                return { success: true, message: "Ignored idle heartbeat for completed session." };
            }

            let currentChallenges = [];
            validChallenges.forEach(newC => {
                const nSub = (newC.subject || 'general').trim().toLowerCase();
                const nTop = (newC.topic || 'General Topic').trim();
                const nAct = (newC.activityType || 'quizzes').trim().toLowerCase();
                const nScore = Math.min(100, Math.max(0, parseFloat(newC.score !== undefined ? newC.score : (newC.percentage || 0)) || 0));
                const nDur = Math.max(1, parseInt(newC.durationSeconds, 10) || 15);
                const nAttemptId = newC.attemptId || null;

                const matchIdx = currentChallenges.findIndex(ec => 
                    (ec.subject || '').trim().toLowerCase() === nSub && 
                    (ec.topic || '').trim().toLowerCase() === nTop.toLowerCase() &&
                    (ec.activityType || 'quizzes').trim().toLowerCase() === nAct
                );

                if (matchIdx !== -1) {
                    const ec = currentChallenges[matchIdx];
                    const prevAttempts = parseInt(ec.attempts, 10) || 1;
                    const prevTotal = parseFloat(ec.totalScore) || (parseFloat(ec.percentage) * prevAttempts) || 0;
                    const prevDur = parseInt(ec.durationSeconds, 10) || 0;

                    const isNewAttempt = nAttemptId && nAttemptId !== ec.lastAttemptId;
                    const incomingAttempts = parseInt(newC.attempts, 10) || 1;

                    if (isNewAttempt || incomingAttempts > prevAttempts) {
                        const newAttempts = isNewAttempt ? prevAttempts + 1 : incomingAttempts;
                        const newTotalScore = prevTotal + nScore;
                        const finalPercentage = Math.min(100, Math.max(0, Math.round(newTotalScore / newAttempts)));
                        currentChallenges[matchIdx] = {
                            subject: ec.subject,
                            topic: ec.topic,
                            activityType: ec.activityType || newC.activityType || 'quizzes',
                            totalScore: newTotalScore,
                            attempts: newAttempts,
                            percentage: finalPercentage,
                            durationSeconds: prevDur + nDur,
                            lastAttemptId: nAttemptId || ec.lastAttemptId
                        };
                    } else {
                        currentChallenges[matchIdx].durationSeconds = Math.max(prevDur, nDur);
                        if (newC.percentage !== undefined) {
                            currentChallenges[matchIdx].percentage = Math.min(100, Math.max(0, Math.round(parseFloat(newC.percentage))));
                        }
                    }
                } else {
                    currentChallenges.push({
                        subject: newC.subject || 'general',
                        topic: nTop,
                        activityType: newC.activityType || 'quizzes',
                        totalScore: nScore,
                        attempts: parseInt(newC.attempts, 10) || 1,
                        percentage: nScore,
                        durationSeconds: nDur,
                        lastAttemptId: nAttemptId
                    });
                }
            });

            const calculatedTotalActivities = currentChallenges.reduce((sum, c) => sum + (parseInt(c.attempts, 10) || 1), 0);
            const updatedTotalActivities = calculatedTotalActivities > 0 ? calculatedTotalActivities : incomingActivities;

            let updatedAvgScore = 0;
            if (currentChallenges.length > 0) {
                const totalPoints = currentChallenges.reduce((sum, c) => sum + (parseFloat(c.totalScore) || (parseFloat(c.percentage) * (parseInt(c.attempts, 10) || 1)) || 0), 0);
                const totalAttempts = currentChallenges.reduce((sum, c) => sum + (parseInt(c.attempts, 10) || 1), 0);
                updatedAvgScore = totalAttempts > 0 ? Math.min(100, Math.max(0, Math.round(totalPoints / totalAttempts))) : 0;
            } else if (incomingScore !== null) {
                updatedAvgScore = Math.min(100, Math.max(0, Math.round(incomingScore)));
            }

            const challengeSecondsSum = currentChallenges.reduce((sum, c) => sum + (parseInt(c.durationSeconds, 10) || 0), 0);
            const finalSeconds = Math.max(incomingSeconds, challengeSecondsSum);

            // Only update activity timestamp if the user is actively interacting
            const updateTimestampClause = (!isIdle && !isHidden) ? ', last_active_at = CURRENT_TIMESTAMP, status = \'Active\'' : '';

            const updateRes = await pool.query(
                `UPDATE students SET 
                    name = $1,
                    parent_whatsapp = $2,
                    email = COALESCE(NULLIF($3, ''), email),
                    active_play_time_seconds = $4,
                    activities_completed = $5,
                    average_score = $6,
                    subject_times = $7,
                    challenges = $8
                    ${updateTimestampClause}
                 WHERE id = $9
                 RETURNING id, parent_whatsapp, name, school_code, product_code`,
                [
                    resolvedName,
                    resolvedPhone,
                    resolvedEmail,
                    finalSeconds,
                    updatedTotalActivities,
                    updatedAvgScore,
                    JSON.stringify(incomingSubjectTimes),
                    JSON.stringify(currentChallenges),
                    currentStudentId
                ]
            );
            student = updateRes.rows[0];
        }

        if (student) {
            student.expiryDate = coupon.exp_date || null;
        }

        return { success: true, student };
    } catch (error) {
        console.error("[Silent Sync Error]:", error.message);
        throw error;
    }
}

async function handleSessionExit(studentId, sessionData) {
    try {
        const rawProduct = (sessionData.productCode || studentId || '').trim().toUpperCase();
        const schoolCode = (sessionData.schoolCode || 'ONLINE-DIRECT').trim().toUpperCase();
        const sessionKey = `${schoolCode}_${rawProduct}`;

        const now = Date.now();
        const lastSentTime = RECENT_EXIT_DISPATCHES.get(rawProduct) || 0;
        const FIVE_MINUTES_MS = 5 * 60 * 1000;

        if (now - lastSentTime < FIVE_MINUTES_MS) {
            console.log(`[Duplicate Exit Blocked] Report for ${rawProduct} was already dispatched recently.`);
            return { success: true, message: "Duplicate exit ignored." };
        }

        const syncResult = await handleSilentSync(studentId, sessionData);
        const student = syncResult.student;

        const activeSecs = sessionData.metrics?.activePlayTimeSeconds || 0;
        const challengesCount = (sessionData.metrics?.challenges || []).length;
        if (activeSecs < 5 && challengesCount === 0) {
            console.log(`[Exit Report Skipped] Negligible session activity for ${student?.name || studentId}.`);
            return { success: true, message: "Skipped negligible session." };
        }

        if (student && student.parent_whatsapp && student.parent_whatsapp !== "+233000000000") {
            const formattedForWhatsApp = {
                id: student.id,
                name: student.name,
                parentWhatsapp: student.parent_whatsapp,
                expiryDate: student.expiryDate || null
            };

            const metricsToDispatch = sessionData.metrics || {};
            RECENT_EXIT_DISPATCHES.set(rawProduct, now);
            RECENT_LOGIN_DISPATCHES.delete(sessionKey);

            await sendWhatsAppNotification(formattedForWhatsApp, metricsToDispatch);
            console.log(`✅ [Session Exit] WhatsApp summary dispatched for: ${student.name}`);

            await pool.query(
                `UPDATE students SET 
                    status = 'Completed',
                    active_play_time_seconds = 0,
                    activities_completed = 0,
                    average_score = 0,
                    challenges = '[]'::jsonb,
                    subject_times = '{}'::jsonb,
                    last_active_at = CURRENT_TIMESTAMP
                 WHERE id = $1`,
                [student.id]
            );
            console.log(`🔄 [Session Reset] Metrics zeroed in PostgreSQL for student ID: ${student.id}`);
        }
        return { success: true, message: "Session exit processed, WhatsApp report sent, and timers reset to 0." };
    } catch (error) {
        console.error("[Session Exit Error]:", error.message);
        throw error;
    }
}

module.exports = { 
    handleSilentSync, 
    handleSessionExit, 
    handleSessionLogin, 
    ensureDatabaseSchema, 
    startTtlCleanupJob 
};