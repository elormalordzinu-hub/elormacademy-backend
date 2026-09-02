// /js/qtd.js
let isMuted = false, currentQ = 0, score = 0, timeUsed = 0, quizData = [];
let timerInterval = null;
let bgMusic = null;
let currentSubject = 'science';
let currentTopic = '';
let currentActivityType = 'quizzes';
let currentAttemptId = null;

// Initialize SessionTracker securely using student/product identifiers
const urlParams = new URLSearchParams(window.location.search);
let activeProductCode = urlParams.get('student') || urlParams.get('code') || localStorage.getItem('mrelorm_plan') || localStorage.getItem('mrelorm_product_code');

window.API_BASE_URL = (!window.location.hostname || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') 
    ? 'http://localhost:3000' 
    : 'https://elormacademy-backend-production.up.railway.app';

// Strict Registration: SessionTracker only instantiates for valid registered subscribers
const sessionTracker = (typeof SessionTracker !== 'undefined' && activeProductCode) 
    ? new SessionTracker(activeProductCode) 
    : null;

let volumeX = localStorage.getItem('mrelorm_bg_volume') !== null ? parseFloat(localStorage.getItem('mrelorm_bg_volume')) : 0.5;
let volumeY = null;

let fullQuestionPool = [];
let usedQuestionPool = [];

const canvas = document.getElementById('confetti-canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
if (canvas) {
    canvas.width = window.innerWidth; 
    canvas.height = window.innerHeight;
}

const endResultSounds = {
    0: new Audio('../assets/sounds/0.mp3'),
    1: new Audio('../assets/sounds/1.mp3'),
    2: new Audio('../assets/sounds/2.mp3'),
    3: new Audio('../assets/sounds/3.mp3'),
    4: new Audio('../assets/sounds/4.mp3'),
    5: new Audio('../assets/sounds/5.mp3')
};

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function startRandomBackgroundMusic() {
    if (bgMusic) {
        bgMusic.pause();
        bgMusic.currentTime = 0;
    }
    const randomNum = Math.floor(Math.random() * 19) + 1;
    bgMusic = new Audio(`../assets/sounds/sound${randomNum}.mp3`);
    bgMusic.loop = true;
    
    const savedVol = localStorage.getItem('mrelorm_bg_volume');
    if (savedVol !== null) {
        volumeX = parseFloat(savedVol);
    } else if (volumeY !== null) {
        volumeX = volumeY;
    }
    
    bgMusic.volume = volumeX;
    bgMusic.muted = isMuted;
    
    const volumeSlider = document.getElementById('volume-slider');
    if (volumeSlider) {
        volumeSlider.value = volumeX;
    }
    
    bgMusic.play().catch(e => console.log("Background music blocked:", e));
}

function setVolume(val) {
    const vol = parseFloat(val);
    volumeY = vol;
    volumeX = volumeY;
    localStorage.setItem('mrelorm_bg_volume', vol);
    
    if (bgMusic) {
        bgMusic.volume = vol;
    }
    Object.values(endResultSounds).forEach(audio => { audio.volume = vol; });
}

function startTimer() {
    clearInterval(timerInterval);
    timeUsed = 0;
    currentAttemptId = 'att_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const timerDisplay = document.getElementById('timer');
    if (timerDisplay) {
        timerDisplay.textContent = 'Time: 0:00';
    }
    startRandomBackgroundMusic();

    if (sessionTracker && typeof sessionTracker.resumeTimer === 'function') {
        sessionTracker.resumeTimer();
    }

    timerInterval = setInterval(() => {
        timeUsed++;
        const mins = Math.floor(timeUsed / 60);
        const secs = timeUsed % 60;
        if (timerDisplay) {
            timerDisplay.textContent = `Time: ${mins}:${secs.toString().padStart(2, '0')}`;
        }
    }, 1000);
}

async function loadQuizData() {
    const quizId = urlParams.get('id');

    if (!quizId) {
        const qEl = document.getElementById('question');
        if (qEl) qEl.textContent = "Error: No quiz ID found in URL.";
        return;
    }

    const catParam = urlParams.get('cat');
    const topicParam = urlParams.get('topic');
    const typeParam = urlParams.get('type');
    let subject = '';
    let curricula = 'cambridge';
    let activity = typeParam || 'quizzes';
    let subYear = 'year-7';

    if (catParam) {
        const parts = catParam.split('|');
        if (parts.length >= 4) {
            subject = parts[0];
            curricula = parts[1];
            activity = typeParam || parts[2];
            subYear = parts[3];
        } else if (parts.length === 3) {
            subject = parts[0];
            curricula = parts[1];
            activity = typeParam || parts[2];
        } else if (parts.length === 2) {
            subject = parts[0];
            curricula = parts[1];
        }
    } else {
        const idParts = quizId.split('-');
        if (idParts[0] === 'phys') subject = 'physics';
        else if (idParts[0] === 'chem') subject = 'chemistry';
        else if (idParts[0] === 'bio') subject = 'biology';
        else if (idParts[0] === 'math') subject = 'mathematics';
        else if (idParts[0] === 'intsci') subject = 'integrated-science';
        
        if (idParts[1]) {
            subYear = idParts[1].replace('yr', 'year-');
        }
    }

    currentSubject = subject || 'science';
    currentTopic = topicParam || 'Quiz Activity';
    currentActivityType = activity || 'quizzes';

    if (sessionTracker) {
        sessionTracker.setSubject(currentSubject);
        if (typeof sessionTracker.setActivityType === 'function') {
            sessionTracker.setActivityType(currentActivityType);
        }
    }

    const formattedCurriculum = curricula.charAt(0).toUpperCase() + curricula.slice(1);
    const formattedGrade = subYear ? subYear.replace('-', ' ') : 'year 7';
    const formattedSubject = subject ? subject.charAt(0).toUpperCase() + subject.slice(1) : 'science';
    
    const lineOne = `${formattedCurriculum} ${formattedGrade} ${formattedSubject}`;
    
    const titleElement = document.getElementById('quiz-title');
    if (titleElement) {
        titleElement.innerHTML = topicParam ? `${lineOne}<br>${topicParam}` : `${lineOne}<br>Activity`;
    }

    let prefix = 'intsci';
    let gradeCode = 'jhs1';
    
    if (subject.includes('integrated-science') || subject.includes('intsci')) {
        prefix = 'intsci';
        subject = 'integrated-science';
    } else if (subject === 'biology' || subject === 'bio') {
        prefix = 'bio';
    } else if (subject === 'physics' || subject === 'phys') {
        prefix = 'phys';
    } else if (subject === 'chemistry' || subject === 'chem') {
        prefix = 'chem';
    } else if (subject === 'mathematics' || subject === 'math') {
        prefix = 'math';
    }

    if (subYear.includes('jhs-1') || subYear.includes('jhs1') || subYear.includes('year-7') || subYear.includes('yr7')) {
        gradeCode = 'jhs1';
    } else if (subYear.includes('jhs-2') || subYear.includes('jhs2') || subYear.includes('year-8') || subYear.includes('yr8')) {
        gradeCode = 'jhs2';
    } else if (subYear.includes('jhs-3') || subYear.includes('jhs3') || subYear.includes('year-9') || subYear.includes('yr9')) {
        gradeCode = 'jhs3';
    }

    let targetQuizId = quizId;
    if (topicParam && !quizId.includes('-')) {
        const topicSlug = topicParam.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
        targetQuizId = `${prefix}-${gradeCode}-${activity}-${topicSlug}`;
    } else if (!quizId.includes(activity)) {
        const topicSlug = quizId.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
        targetQuizId = `${prefix}-${gradeCode}-${activity}-${topicSlug}`;
    }

    let path = `../data/content/${curricula}/${subject}/${activity}/${targetQuizId}.json`;

    if (!subject) {
        const qEl = document.getElementById('question');
        if (qEl) qEl.textContent = `System Error: Could not determine subject path. Attempted path was: ${path}`;
        return;
    }

    try {
        let response = await fetch(path);
        
        if (!response.ok) {
            const fallbackPath = `../data/content/${curricula}/${subject}/${targetQuizId}.json`;
            response = await fetch(fallbackPath);
            if (!response.ok) throw new Error(`Could not find file at path: ${path}`);
        }
        
        const jsonData = await response.json();
        
        let questionsArray = jsonData.questions;
        if (!questionsArray && Array.isArray(jsonData)) {
            questionsArray = jsonData;
        }

        fullQuestionPool = shuffleArray([...questionsArray]);
        usedQuestionPool = [];

        setupNextQuizBatch();
        startTimer();
        loadQuestion();
    } catch (error) {
        console.error("Path/Data Error:", error);
        const qEl = document.getElementById('question');
        if (qEl) qEl.textContent = `System Error: Could not find file at path: ${path}`;
    }
}

function setupNextQuizBatch() {
    if (fullQuestionPool.length < 5) {
        fullQuestionPool = fullQuestionPool.concat(shuffleArray([...usedQuestionPool]));
        usedQuestionPool = [];
    }

    quizData = fullQuestionPool.splice(0, 5);
    usedQuestionPool.push(...quizData);
}

function toggleMute() {
    isMuted = !isMuted;
    if (bgMusic) bgMusic.muted = isMuted;
    const muteBtn = document.getElementById('mute-btn');
    if (muteBtn) muteBtn.textContent = isMuted ? '🔇' : '🔊';
}

function handleAnswer(idx) {
    const fb = document.getElementById('q-feedback');
    const correctIdx = quizData[currentQ].correct;
    const buttons = document.querySelectorAll('.option-btn');
    
    buttons.forEach(btn => btn.disabled = true);
    
    if (idx === correctIdx) {
        score++;
        if (fb) fb.innerHTML = '<span style="color:#00ff00">✔</span>';
    } else {
        if (buttons[correctIdx]) buttons[correctIdx].classList.add('btn-correct-show');
        if (fb) fb.innerHTML = '<span style="color:#ff4081">✘</span>';
    }
    
    if (fb) fb.style.display = 'block';
    const scoreDisp = document.getElementById('score-display');
    if (scoreDisp) scoreDisp.textContent = `Score: ${score}/5`;
    
    setTimeout(() => {
        if (fb) fb.style.display = 'none';
        currentQ++;
        currentQ < quizData.length ? loadQuestion() : endQuiz();
    }, 1200);
}

function loadQuestion() {
    const qEl = document.getElementById('question');
    const optDiv = document.getElementById('options'); 
    if (qEl && quizData[currentQ]) qEl.innerHTML = `${currentQ+1}. ${quizData[currentQ].q}`;
    if (optDiv && quizData[currentQ]) {
        optDiv.innerHTML = '';
        quizData[currentQ].a.forEach((opt, i) => {
            const btn = document.createElement('button');
            btn.className = 'option-btn'; 
            btn.innerHTML = opt;
            btn.onclick = () => handleAnswer(i);
            optDiv.appendChild(btn);
        });
    }
}

function triggerConfetti() {
    if (!canvas || !ctx) return;
    const colors = ['#00e5ff', '#ff4081', '#ffe600', '#00ff00'];
    const particles = Array.from({length: 600}, () => ({
        x: canvas.width/2, y: canvas.height/2,
        vx: (Math.random()-0.5)*25, vy: (Math.random()-0.5)*25,
        color: colors[Math.floor(Math.random()*colors.length)],
        size: Math.random() * 7 + 2
    }));
    function animate() {
        ctx.clearRect(0,0,canvas.width, canvas.height);
        particles.forEach(p => { p.x += p.vx; p.y += p.vy; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); });
        requestAnimationFrame(animate);
    }
    animate();
}

function endQuiz() {
    // 1. Immediately freeze quiz stopwatch interval
    clearInterval(timerInterval);
    
    if (bgMusic) { bgMusic.pause(); bgMusic.currentTime = 0; }
    Object.values(endResultSounds).forEach(audio => { audio.pause(); audio.currentTime = 0; });
    
    const percentageScore = Math.round((score / 5) * 100);
    const completedDuration = Math.max(10, timeUsed);

    // 2. Log single finished assessment attempt with unique attemptId
    if (sessionTracker) {
        sessionTracker.logActivityCompletion(percentageScore, {
            attemptId: currentAttemptId,
            subject: currentSubject,
            topic: currentTopic,
            activityType: currentActivityType,
            score: percentageScore,
            durationSeconds: completedDuration
        });
        if (typeof sessionTracker.syncSilently === 'function') {
            sessionTracker.syncSilently().catch(e => console.log("Silent telemetry sync error:", e));
        }
        // 3. Freeze continuous session clock while on score screen
        if (typeof sessionTracker.pauseTimer === 'function') {
            sessionTracker.pauseTimer();
        }
    }
    
    let finalSound = endResultSounds[score] || endResultSounds[0];
    
    if (!isMuted) {
        const volumeSlider = document.getElementById('volume-slider');
        if (volumeSlider) {
            finalSound.volume = parseFloat(volumeSlider.value);
        }
        finalSound.play().catch(e => console.log("Final sound error:", e));
    }
    
    const messages = ["Keep practicing! 📚", "Don't give up! 💡", "Good effort! 📝", "Getting there! 🌱", "Nice job! 👍", "Well done! 🌟", "Very good! 🚀", "Great work! 🏆", "Excellent! 🔥", "Perfect score! 💎"];
    const index = Math.min(Math.floor(score * 2), messages.length - 1);
    
    const msgElement = document.getElementById('final-msg-text');
    if (msgElement) {
        msgElement.textContent = messages[index];
        msgElement.style.color = '#ffa500';
    }
    
    const finalStats = document.getElementById('final-stats');
    const timerDisplay = document.getElementById('timer');
    if (finalStats && timerDisplay) {
        finalStats.textContent = `Final Score: ${score}/5 | Time: ${timerDisplay.textContent.split(': ')[1] || '0:00'}`;
    }
    const finalOverlay = document.getElementById('final-overlay');
    if (finalOverlay) finalOverlay.style.display = 'flex';
    triggerConfetti();
}

function restartWithId() {
    score = 0;
    currentQ = 0;
    clearInterval(timerInterval);
    
    if (bgMusic) { bgMusic.pause(); bgMusic.currentTime = 0; }
    Object.values(endResultSounds).forEach(audio => { audio.pause(); audio.currentTime = 0; });
    
    const finalOverlay = document.getElementById('final-overlay');
    const optionsDiv = document.getElementById('options');
    const feedbackDiv = document.getElementById('q-feedback');
    if (finalOverlay) finalOverlay.style.display = 'none';
    if (optionsDiv) optionsDiv.innerHTML = '';
    if (feedbackDiv) feedbackDiv.style.display = 'none';
    
    setupNextQuizBatch();
    startTimer();
    loadQuestion();
}

loadQuizData();

document.addEventListener('keydown', function(event) {
    if (event.key === 'Backspace') {
        const activeElement = document.activeElement;
        const isInput = activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA';
        
        if (!isInput) {
            const backBtn = document.querySelector('.btn-back') || document.querySelector('.btn-nav');
            if (backBtn) {
                backBtn.click();
            } else {
                window.history.back();
            }
        }
    }
}, { capture: true });