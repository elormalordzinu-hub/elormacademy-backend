// File: js/sessionTracker.js | System: Bright & Bold Student App (Strict Single Login Guard & Telemetry Purge)
class SessionTracker {
    constructor(studentId) {
        const isSubscriber = localStorage.getItem('mrelorm_subscriber') === 'true';
        const productCode = studentId || localStorage.getItem('mrelorm_plan') || localStorage.getItem('mrelorm_product_code');

        if (!isSubscriber || !productCode || productCode.startsWith('GUEST-') || productCode === 'STU-9921') {
            this.isTrackingEnabled = false;
            this.studentId = null;
            return;
        }

        this.isTrackingEnabled = true;
        this.studentId = productCode.trim().toUpperCase();
        this.productCode = this.studentId;
        this.studentName = localStorage.getItem('studentName') || sessionStorage.getItem('currentStudentName') || 'STUDENT';
        this.schoolCode = localStorage.getItem('schoolCode') || 'ONLINE-DIRECT';
        
        sessionStorage.setItem('tracked_student_id', this.studentId);
        sessionStorage.setItem('tracked_product_code', this.productCode);
        sessionStorage.setItem('tracked_school_code', this.schoolCode);
        sessionStorage.setItem('tracked_student_name', this.studentName);

        sessionStorage.removeItem('bb_is_internal_navigation');

        const savedData = this.getSavedSessionData();
        this.activePlayTimeSeconds = savedData.activePlayTimeSeconds || 0;
        this.subjectTimes = savedData.subjectTimes || { chemistry: 0, physics: 0, maths: 0, 'integrated-science': 0, biology: 0 };
        this.activitiesCompleted = savedData.activitiesCompleted || 0;
        this.scores = savedData.scores || [];
        this.challenges = savedData.challenges || [];
        
        this.currentSubject = sessionStorage.getItem('currentSubject') || 'physics';
        this.currentActivityType = sessionStorage.getItem('currentActivity') || 'quizzes';
        this.timerInterval = null;
        this.heartbeatInterval = null;
        this.isIdle = false;
        this.isTabHidden = document.hidden || false;
        this.isPaused = false;
        this.idleTimer = null;

        this.initTracking();

        // Strict Single Login: Only fire if no login alert has been dispatched for this specific signature
        const loginSignature = `${this.schoolCode}_${this.productCode}`.toUpperCase();
        const existingLock = localStorage.getItem('bb_login_sent_signature');
        if (existingLock !== loginSignature) {
            this.sendLoginAlert();
        }
    }

    getSavedSessionData() {
        try {
            const raw = localStorage.getItem('bb_continuous_session_data') || sessionStorage.getItem('bb_continuous_session_data');
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    saveCurrentState() {
        if (!this.isTrackingEnabled) return;
        try {
            const state = {
                activePlayTimeSeconds: this.activePlayTimeSeconds,
                subjectTimes: this.subjectTimes,
                activitiesCompleted: this.activitiesCompleted,
                scores: this.scores,
                challenges: this.challenges
            };
            localStorage.setItem('bb_continuous_session_data', JSON.stringify(state));
            sessionStorage.setItem('bb_continuous_session_data', JSON.stringify(state));
        } catch (e) {}
    }

    clearSavedSessionData() {
        localStorage.removeItem('bb_continuous_session_data');
        localStorage.removeItem('bb_last_active_timestamp');
        localStorage.removeItem('bb_session_start_timestamp');
        localStorage.removeItem('bb_login_sent_signature');
        sessionStorage.removeItem('bb_continuous_session_data');
        sessionStorage.removeItem('bb_is_internal_navigation');
        this.activePlayTimeSeconds = 0;
        this.subjectTimes = { chemistry: 0, physics: 0, maths: 0, 'integrated-science': 0, biology: 0 };
        this.activitiesCompleted = 0;
        this.scores = [];
        this.challenges = [];
    }

    getApiBase() {
        if (typeof window.API_BASE_URL !== 'undefined' && window.API_BASE_URL !== '') {
            return window.API_BASE_URL;
        }
        return (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? 'http://localhost:3000'
            : 'https://elormacademy-backend-production.up.railway.app';
    }

    async sendLoginAlert() {
        if (!this.isTrackingEnabled) return;

        const loginSignature = `${this.schoolCode}_${this.productCode}`.toUpperCase();
        localStorage.setItem('bb_login_sent_signature', loginSignature);

        this.studentName = localStorage.getItem('studentName') || sessionStorage.getItem('currentStudentName') || this.studentName;
        this.schoolCode = localStorage.getItem('schoolCode') || this.schoolCode;

        const payload = {
            studentId: this.studentId,
            sessionData: {
                studentName: this.studentName,
                schoolCode: this.schoolCode,
                productCode: this.productCode,
                parentWhatsapp: localStorage.getItem('parentWhatsapp') || sessionStorage.getItem('parentWhatsapp') || '+233000000000'
            }
        };

        try {
            const response = await fetch(`${this.getApiBase()}/api/session/login-alert`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                localStorage.removeItem('bb_login_sent_signature');
            }
        } catch (error) {
            localStorage.removeItem('bb_login_sent_signature');
            console.warn("[Login Alert Notice] Server unreachable:", error.message);
        }
    }

    pauseTimer() {
        this.isPaused = true;
        this.saveCurrentState();
    }

    resumeTimer() {
        this.isPaused = false;
        this.isIdle = false;
        localStorage.setItem('bb_last_active_timestamp', String(Date.now()));
    }

    initTracking() {
        if (!this.isTrackingEnabled) return;

        localStorage.setItem('bb_last_active_timestamp', String(Date.now()));

        document.addEventListener('click', (e) => {
            if (e.target.closest('a') || e.target.closest('button')) {
                sessionStorage.setItem('bb_is_internal_navigation', 'true');
            }
        }, { capture: true });

        const isActivityPage = window.location.pathname.includes('qtd.html') || window.location.pathname.includes('simulation.html');

        this.timerInterval = setInterval(() => {
            if (isActivityPage && !this.isIdle && !this.isTabHidden && !this.isPaused && document.hasFocus()) {
                this.activePlayTimeSeconds++;
                if (this.subjectTimes[this.currentSubject] !== undefined) {
                    this.subjectTimes[this.currentSubject]++;
                } else {
                    this.subjectTimes[this.currentSubject] = 1;
                }
                this.saveCurrentState();
            }
        }, 1000);

        this.heartbeatInterval = setInterval(() => {
            if (!this.isIdle) {
                this.syncSilently().catch(() => {});
            }
        }, 10000);

        const handleUserActivity = () => {
            if (!this.isTrackingEnabled) return;

            if (this.isIdle) {
                this.isIdle = false;
                this.syncSilently().catch(() => {});
            }

            localStorage.setItem('bb_last_active_timestamp', String(Date.now()));
            
            clearTimeout(this.idleTimer);
            this.idleTimer = setTimeout(() => {
                this.isIdle = true;
                this.syncSilently().catch(() => {});
                this.clearSavedSessionData();
            }, 15 * 60 * 1000);
        };

        ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(evt => {
            window.addEventListener(evt, handleUserActivity, { passive: true });
        });

        document.addEventListener('visibilitychange', () => {
            this.isTabHidden = document.hidden;
            this.saveCurrentState();
            if (!this.isIdle) {
                this.syncSilently().catch(() => {});
            }
        });

        window.addEventListener('blur', () => {
            this.isTabHidden = true;
            this.saveCurrentState();
        });

        window.addEventListener('focus', () => {
            this.isTabHidden = false;
            handleUserActivity();
        });

        handleUserActivity();
    }

    setSubject(subjectName) {
        if (!this.isTrackingEnabled || !subjectName) return;
        const lower = subjectName.toLowerCase();
        if (this.subjectTimes[lower] === undefined) {
            this.subjectTimes[lower] = 0;
        }
        this.currentSubject = lower;
        sessionStorage.setItem('currentSubject', lower);
        this.saveCurrentState();
    }

    setActivityType(activityType) {
        if (!this.isTrackingEnabled || !activityType) return;
        this.currentActivityType = activityType.toLowerCase().trim();
        sessionStorage.setItem('currentActivity', this.currentActivityType);
    }

    logActivityCompletion(score, challengeData = null) {
        if (!this.isTrackingEnabled) return;

        const cleanScore = Math.min(100, Math.max(0, Math.round(Number(score) || 0)));

        this.activitiesCompleted++;
        this.scores.push(cleanScore);

        if (challengeData) {
            const sub = (challengeData.subject || this.currentSubject || 'general').trim();
            const top = (challengeData.topic || 'General Topic').trim();
            const actType = (challengeData.activityType || this.currentActivityType || 'quizzes').trim();
            const dur = Math.max(1, parseInt(challengeData.durationSeconds, 10) || 15);
            const sc = cleanScore;
            const attId = challengeData.attemptId || null;

            const existingIdx = this.challenges.findIndex(c => 
                (c.subject || '').toLowerCase() === sub.toLowerCase() && 
                (c.topic || '').toLowerCase() === top.toLowerCase() &&
                (c.activityType || 'quizzes').toLowerCase() === actType.toLowerCase()
            );

            if (existingIdx !== -1) {
                const prevAttempts = this.challenges[existingIdx].attempts || 1;
                const newAttempts = prevAttempts + 1;
                const newTotal = (this.challenges[existingIdx].totalScore || (this.challenges[existingIdx].score * prevAttempts)) + sc;
                
                this.challenges[existingIdx].totalScore = newTotal;
                this.challenges[existingIdx].attempts = newAttempts;
                this.challenges[existingIdx].score = Math.min(100, Math.round(newTotal / newAttempts));
                this.challenges[existingIdx].durationSeconds = (this.challenges[existingIdx].durationSeconds || 0) + dur;
                this.challenges[existingIdx].activityType = actType;
                this.challenges[existingIdx].attemptId = attId;
            } else {
                this.challenges.push({
                    attemptId: attId,
                    subject: sub,
                    topic: top,
                    activityType: actType,
                    score: sc,
                    totalScore: sc,
                    attempts: 1,
                    durationSeconds: dur
                });
            }
        }
        this.saveCurrentState();
    }

    getPayload() {
        const saved = this.getSavedSessionData();
        const latestChallenges = (this.challenges && this.challenges.length > 0) ? this.challenges : (saved.challenges || []);
        
        const challengeDurationSum = latestChallenges.reduce((sum, c) => sum + (parseInt(c.durationSeconds, 10) || 0), 0);
        const latestSecs = Math.max(this.activePlayTimeSeconds, saved.activePlayTimeSeconds || 0, challengeDurationSum);
        
        const latestActivities = Math.max(this.activitiesCompleted, saved.activitiesCompleted || 0, latestChallenges.length);
        const latestScores = (this.scores && this.scores.length > 0) ? this.scores : (saved.scores || []);
        
        let avgScore = 0;
        if (latestChallenges.length > 0) {
            const sumScores = latestChallenges.reduce((acc, c) => acc + (parseFloat(c.score) || 0), 0);
            avgScore = Math.min(100, Math.max(0, Math.round(sumScores / latestChallenges.length)));
        } else if (latestScores.length > 0) {
            avgScore = Math.min(100, Math.max(0, Math.round(latestScores.reduce((a, b) => a + b, 0) / latestScores.length)));
        }

        return {
            studentId: this.studentId,
            sessionData: {
                studentName: this.studentName,
                schoolCode: this.schoolCode,
                productCode: this.productCode,
                parentWhatsapp: localStorage.getItem('parentWhatsapp') || sessionStorage.getItem('parentWhatsapp') || '+233000000000',
                isTabHidden: this.isTabHidden,
                metrics: {
                    activePlayTimeSeconds: latestSecs,
                    subjectTimes: this.subjectTimes,
                    activitiesCompleted: latestActivities,
                    averageScore: avgScore,
                    isIdle: this.isIdle,
                    challenges: latestChallenges
                }
            }
        };
    }

    async syncSilently() {
        if (!this.isTrackingEnabled) return;
        const payload = this.getPayload();
        try {
            await fetch(`${this.getApiBase()}/api/telemetry/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (error) {}
    }
}