// File: quiz-engine.js | System: Bright & Bold Learning Arena

// Global HTML Escaping Utility to prevent DOM-based XSS
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const quizId = urlParams.get('id'); // e.g., "chem-yr7-1"
    
    if (!quizId) {
        const titleEl = document.getElementById('quiz-title');
        if (titleEl) titleEl.innerText = "Activity not found.";
        return;
    }

    try {
        // Fetch the quiz/activity data safely over relative path
        const response = await fetch('../data/activities.json'); 
        if (!response.ok) throw new Error('Failed to fetch activities data.');
        const data = await response.json();

        // Logic to find the specific activity inside your JSON
        const activity = typeof findActivityById === 'function' ? findActivityById(data, quizId) : null;

        if (activity) {
            renderActivity(activity);
        } else {
            const titleEl = document.getElementById('quiz-title');
            if (titleEl) titleEl.innerText = "Activity not found.";
        }
    } catch (err) {
        console.error("Failed to load activity:", err);
        const titleEl = document.getElementById('quiz-title');
        if (titleEl) titleEl.innerText = "Error loading activity.";
    }
});

function renderActivity(activity) {
    const container = document.getElementById('content-area');
    const titleEl = document.getElementById('quiz-title');
    
    if (titleEl && activity && activity.name) {
        titleEl.innerText = activity.name;
    }

    if (!container || !activity) return;

    const safeName = escapeHtml(activity.name);

    // Here we decide how to display it based on 'type' safely with HTML escaping
    if (activity.type === 'quiz') {
        container.innerHTML = `<p>Displaying Quiz: ${safeName}</p>`; 
        // Load your quiz builder logic here
    } else if (activity.type === 'tf') {
        container.innerHTML = `<p>Displaying True/False: ${safeName}</p>`;
    }
}