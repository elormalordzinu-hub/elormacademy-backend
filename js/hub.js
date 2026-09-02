// /js/hub.js

// Add this mapping for display labels
const displayMap = {
    'alevel': 'A-LEVEL',
    'igcse': 'IGCSE'
};

function getApiBaseUrl() {
    if (typeof window.API_BASE_URL !== 'undefined' && window.API_BASE_URL !== '') {
        return window.API_BASE_URL;
    }
    return (!window.location.hostname || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://localhost:3000'
        : 'https://elormacademy-backend-production.up.railway.app';
}

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

// Strict validation helper for path parameters to prevent path traversal
function isValidParam(str, allowHyphen = true) {
    if (!str) return false;
    const regex = allowHyphen ? /^[a-zA-Z0-9_-]+$/ : /^[a-zA-Z0-9_]+$/;
    return regex.test(str);
}

async function renderHub() {
    const title = document.getElementById('hub-title');
    const container = document.getElementById('list-container');
    
    const params = new URLSearchParams(window.location.search);
    let cat = params.get('cat');

    // --- RECOVERY LOGIC ---
    if (cat && cat.includes('null')) {
        const savedCat = sessionStorage.getItem('last_valid_cat');
        if (savedCat) {
            const parts = cat.split('|');
            const savedParts = savedCat.split('|');
            cat = `${savedParts[0]}|${savedParts[1]}|${parts[2]}|${parts[3]}`;
        }
    }

    if (!cat || cat.includes('null')) {
        title.innerText = "Selection Error";
        container.innerHTML = `<p>Category data corrupted. Please re-select from the <a href="menu.html">Main Menu</a>.</p>`;
        return;
    }

    const catParts = cat.split('|');
    if (catParts.length !== 4) {
        title.innerText = "Selection Error";
        container.innerHTML = `<p>Invalid category structure. Please re-select from the <a href="menu.html">Main Menu</a>.</p>`;
        return;
    }

    const [subject, curriculum, type, grade] = catParts;

    // Strict parameter sanitization and validation to prevent path traversal and injection
    if (!isValidParam(subject) || !isValidParam(curriculum) || !isValidParam(type) || !isValidParam(grade)) {
        title.innerText = "Security Error";
        container.innerHTML = `<p style="color: #ff4081;">Invalid characters detected in navigation parameters.</p>`;
        return;
    }

    sessionStorage.setItem('last_valid_cat', cat);

    // Create the display-friendly grade string
    const displayGrade = displayMap[grade] || grade.toUpperCase();

    try {
        const response = await fetch(`../data/${encodeURIComponent(curriculum)}.json`);
        if (!response.ok) throw new Error(`Could not load curriculum data file.`);
        
        const data = await response.json();
        
        const subjectData = data[subject];
        const gradeData = subjectData ? subjectData[grade] : null;
        const items = gradeData ? gradeData[type] : null;

        if (!items || !Array.isArray(items) || items.length === 0) {
            title.innerText = `${subject.toUpperCase()} | ${displayGrade} | ${type.toUpperCase()}`;
            container.innerHTML = `<p>No ${escapeHtml(type)} available for ${escapeHtml(grade)} yet. Check back soon!</p>`;
            return;
        }

        title.innerText = `${subject.toUpperCase()} | ${displayGrade} | ${type.toUpperCase()}`;
        container.innerHTML = '';
        
        items.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = 'list-card';
            
            const seqNumber = index + 1;
            card.setAttribute('data-sequence', seqNumber);

            const isSubscriber = localStorage.getItem('mrelorm_subscriber') === 'true';
            const safeItemName = escapeHtml(item.name);

            if (isSubscriber) {
                card.innerHTML = `<span>${seqNumber}. ${safeItemName}</span> <span style="float: right; background: #00ff00; color: #050505; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: bold;"><i class="fa-solid fa-lock-open"></i> UNLOCKED</span>`;
            } else if (seqNumber <= 3) {
                card.innerHTML = `<span>${seqNumber}. ${safeItemName}</span> <span style="float: right; background: #00ff00; color: #050505; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: bold;"><i class="fa-solid fa-lock-open"></i> UNLOCKED / FREE</span>`;
            } else {
                card.innerHTML = `<span>${seqNumber}. ${safeItemName}</span> <span style="float: right; background: #ff4081; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: bold;"><i class="fa-solid fa-lock"></i> LOCKED / PRO</span>`;
            }
            
            card.onclick = () => {
                if (seqNumber <= 3) {
                    navigateToActivity(type, item, cat);
                    return;
                }

                const localSubscriber = localStorage.getItem('mrelorm_subscriber') === 'true';
                const productCode = localStorage.getItem('mrelorm_plan') || localStorage.getItem('mrelorm_product_code');
                const expiry = parseInt(localStorage.getItem('mrelorm_expiry'), 10);

                if (localSubscriber && productCode) {
                    if (!expiry || Date.now() < expiry) {
                        navigateToActivity(type, item, cat);
                        return;
                    }
                }

                showColourfulRedirectModal();
            };
            container.appendChild(card);
        });

    } catch (err) {
        console.error(err);
        title.innerText = "Error Loading Content";
        container.innerHTML = `<p style="color: #ff4081;">Error securely loading learning module.</p>`;
    }
}

function navigateToActivity(type, item, cat) {
    let targetPage = 'default.html';
    
    switch(type.toLowerCase()) {
        case 'quizzes':
        case 'true-false':
        case 'definitions':
        case 'games':
        case 'study-guides':
            targetPage = 'qtd.html';
            break;
        case 'simulation':
            targetPage = 'simulation.html';
            break;
        case 'video':
            targetPage = 'video.html';
            break;
        case 'worksheet':
            targetPage = 'worksheet.html';
            break;
        case 'experiment':
            targetPage = 'experiment.html';
            break;
        case 'notes':
            targetPage = 'notes.html';
            break;
    }
    
    window.location.href = `${targetPage}?id=${encodeURIComponent(item.id)}&type=${encodeURIComponent(type)}&cat=${encodeURIComponent(cat)}&topic=${encodeURIComponent(item.name)}`;
}

function showColourfulRedirectModal() {
    let existing = document.getElementById('brightColourfulModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'brightColourfulModal';
    overlay.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(5, 5, 5, 0.85);
        backdrop-filter: blur(8px);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 999999;
        font-family: inherit;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
        background: #0a0a0a;
        border: 2px solid #00e5ff;
        box-shadow: 0 0 30px rgba(0, 229, 255, 0.4);
        border-radius: 16px;
        padding: 30px;
        width: 90%;
        max-width: 400px;
        text-align: center;
        animation: modalPop 0.3s ease-out;
    `;

    card.innerHTML = `
        <h3 style="color: #ffe600; margin-top: 0; font-size: 1.3rem; letter-spacing: 1px; text-transform: uppercase;">🔒 Pro Content Locked</h3>
        <p style="color: #ffffff; font-size: 0.95rem; line-height: 1.6; margin-bottom: 25px;">
            This content requires a Pro subscription. Please click the Unlock button on the home page!
        </p>
        <div style="display: flex; gap: 10px;">
            <button id="closeModalBtn" style="
                flex: 1; padding: 12px; background: #333; color: #ffffff; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; font-size: 13px;
            ">Cancel</button>
            <button id="goToHomeBtn" style="
                flex: 1; padding: 12px; background: linear-gradient(135deg, #00ff00, #00e5ff); color: #050505; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; font-size: 13px;
            ">OK - Home</button>
        </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    document.getElementById('closeModalBtn').onclick = () => {
        overlay.remove();
    };

    document.getElementById('goToHomeBtn').onclick = () => {
        sessionStorage.setItem('trigger_unlock', 'true');
        window.location.href = '../index.html';
    };
}

window.addEventListener('popstate', renderHub);
document.addEventListener('DOMContentLoaded', renderHub);

const searchBar = document.getElementById('search-bar');
if (searchBar) {
    searchBar.addEventListener('input', function(e) {
        const searchTerm = e.target.value.toLowerCase();
        const items = document.querySelectorAll('.list-card');
        const stopWords = ['i', 'want', 'the', 'a', 'an', 'of', 'in', 'to', 'for', 'with', 'on', 'my', 'is', 'please'];
        
        const keywords = searchTerm
            .split(/\s+/)
            .filter(word => word.length > 0 && !stopWords.includes(word))
            .map(word => word.replace(/s$/, ''));

        items.forEach(item => {
            const itemText = item.innerText.toLowerCase().replace(/s\b/g, '');
            if (keywords.length === 0) {
                item.style.display = 'block';
            } else {
                const isMatch = keywords.some(keyword => itemText.includes(keyword));
                item.style.display = isMatch ? 'block' : 'none';
            }
        });
    });
}

async function checkTopicAccess(topicIndex, userEmail) {
    const isSubscriber = localStorage.getItem('mrelorm_subscriber') === 'true';
    const expiry = parseInt(localStorage.getItem('mrelorm_expiry'), 10);

    if (topicIndex < 3) {
        return true; 
    }

    if (!isSubscriber) {
        showColourfulRedirectModal();
        return false;
    }

    if (expiry && Date.now() < expiry) {
        return true;
    }

    const productCode = localStorage.getItem('mrelorm_plan') || localStorage.getItem('mrelorm_product_code');
    if (!productCode) {
        showColourfulRedirectModal();
        return false;
    }

    return true;
}