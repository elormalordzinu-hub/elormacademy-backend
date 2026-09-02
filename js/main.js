// /js/main.js
// BrightandBold Core Engine v1.0 & State Controller
console.log("BrightandBold v1.0 Initialized");

/**
 * Utility to escape HTML entities and prevent XSS attacks.
 */
function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
}

// Safely define API_BASE_URL globally using 'var' to prevent duplicate declaration syntax errors
if (typeof window.API_BASE_URL === 'undefined') {
    window.API_BASE_URL = (!window.location.hostname || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://localhost:3000'
        : 'https://elormacademy-backend-production.up.railway.app';
}
var API_BASE_URL = window.API_BASE_URL;

// Global SessionTracker instance for root/index tracking
var globalSessionTracker = null;

// Centralized State Controller & Dynamic UI Adaptation
const AuthState = {
    getUserState() {
        const isSubscriber = localStorage.getItem('mrelorm_subscriber') === 'true';
        const productCode = localStorage.getItem('mrelorm_plan') || localStorage.getItem('mrelorm_product_code');
        const expiryDate = localStorage.getItem('mrelorm_expiry');

        if (!isSubscriber || !productCode) {
            return 'NEW_USER';
        }

        if (expiryDate && Date.now() > parseInt(expiryDate)) {
            return 'RENEWAL_REQUIRED';
        }

        return 'REGISTERED_ACTIVE';
    },

    initUI() {
        const state = this.getUserState();
        const unlockBtn = document.getElementById('dynamic-unlock-btn');
        const subtitle = document.getElementById('user-status-subtitle');
        const deleteBtn = document.getElementById('delete-account-btn');

        switch (state) {
            case 'REGISTERED_ACTIVE':
                if (unlockBtn) {
                    unlockBtn.textContent = '⚡ Lab Stage Unlocked (Active Subscriber)';
                    unlockBtn.style.background = 'linear-gradient(135deg, #00ff00, #00e5ff)';
                }
                if (subtitle) {
                    subtitle.textContent = 'Welcome back! Your subscription is active. Enter your name and choose your path.';
                }
                if (deleteBtn) {
                    deleteBtn.style.display = 'block';
                }
                break;

            case 'RENEWAL_REQUIRED':
                if (unlockBtn) {
                    unlockBtn.textContent = '🔄 Renew Subscription Pass';
                    unlockBtn.style.background = 'linear-gradient(135deg, #ff4081, #ffe600)';
                }
                if (subtitle) {
                    subtitle.textContent = 'Your subscription pass has expired. Please renew to continue.';
                }
                if (deleteBtn) {
                    deleteBtn.style.display = 'block';
                }
                break;

            case 'NEW_USER':
            default:
                if (unlockBtn) {
                    unlockBtn.textContent = '🚀 STUDENT FULL ACCESS UNLOCK / SUBSCRIBE';
                    unlockBtn.style.background = 'linear-gradient(135deg, #00ff00, #ff4081)';
                }
                if (subtitle) {
                    subtitle.textContent = 'Enter your name and choose your path to unlock the arena.';
                }
                if (deleteBtn) {
                    deleteBtn.style.display = 'none';
                }
                break;
        }
    }
};

/**
 * Stunning Custom Popup Modal Builder to replace browser alerts
 */
function showCustomPopup(title, message, type = 'info', onOk = null) {
    let existing = document.getElementById('brightCustomModal');
    if (existing) existing.remove();

    let borderColor = '#00e5ff';
    let headerColor = '#ffe600';
    let icon = 'ℹ️';

    if (type === 'success') {
        borderColor = '#00ff00';
        headerColor = '#00ff00';
        icon = '🎉';
    } else if (type === 'error') {
        borderColor = '#ff4081';
        headerColor = '#ff4081';
        icon = '⚠️';
    }

    const overlay = document.createElement('div');
    overlay.id = 'brightCustomModal';
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
        border: 2px solid ${borderColor};
        box-shadow: 0 0 30px rgba(0, 229, 255, 0.3);
        border-radius: 16px;
        padding: 30px;
        width: 90%;
        max-width: 420px;
        text-align: center;
        animation: modalPop 0.3s ease-out;
    `;

    card.innerHTML = `
        <div style="font-size: 2.5rem; margin-bottom: 10px;">${icon}</div>
        <h3 style="color: ${headerColor}; margin-top: 0; font-size: 1.3rem; letter-spacing: 1px; text-transform: uppercase;">${escapeHtml(title)}</h3>
        <p style="color: #ffffff; font-size: 0.95rem; line-height: 1.6; margin-bottom: 20px;">
            ${escapeHtml(message)}
        </p>
        <button id="customModalOkBtn" style="
            width: 100%; padding: 12px; background: linear-gradient(135deg, #00ff00, #00e5ff); color: #050505; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; font-size: 13px;
        ">OK</button>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    document.getElementById('customModalOkBtn').onclick = () => {
        overlay.remove();
        if (typeof onOk === 'function') {
            onOk();
        }
    };
}

/**
 * Stunning Custom Colorful Popup Helper for Intercepts & Confirmation
 */
function showColorfulAlert(message, title = "Notice", callback = null, showCancel = false) {
    let existing = document.getElementById('customColorfulPopup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = 'customColorfulPopup';
    popup.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(5, 5, 5, 0.85); z-index: 20000;
        display: flex; justify-content: center; align-items: center; backdrop-filter: blur(5px);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    `;

    popup.innerHTML = `
        <div style="background:#0e0e0e; border:2px solid #ffe600; border-radius:10px; padding:25px; width:90%; max-width:420px; box-shadow:0 0 25px rgba(255,230,0,0.3); text-align:center; color:#fff;">
            <h3 style="color:#ffe600; margin-top:0; text-transform:uppercase; font-size:18px;">${escapeHtml(title)}</h3>
            <p style="font-size:14px; color:#ddd; line-height:1.5; margin-bottom:20px; white-space: pre-line;">${escapeHtml(message)}</p>
            <div style="display:flex; gap:10px; justify-content:center;">
                <button id="popupOkBtn" style="background:#00e5ff; color:#050505; border:none; padding:10px 20px; font-weight:bold; border-radius:5px; cursor:pointer; text-transform:uppercase;">OK</button>
                <button id="popupCancelBtn" style="background:transparent; border:1px solid #555; color:#aaa; padding:10px 20px; font-weight:bold; border-radius:5px; cursor:pointer; text-transform:uppercase; display:${showCancel ? 'block' : 'none'};">Cancel</button>
            </div>
        </div>
    `;

    document.body.appendChild(popup);

    document.getElementById('popupOkBtn').onclick = () => {
        popup.remove();
        if (callback) callback(true);
    };

    if (showCancel) {
        document.getElementById('popupCancelBtn').onclick = () => {
            popup.remove();
            if (callback) callback(false);
        };
    }
}

/**
 * Verification Modal Intercept (Appears when clicking CONTINUE on payment success)
 */
function showVerificationModal(paymentData) {
    let existing = document.getElementById('userVerificationModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'userVerificationModal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(5,5,5,0.95); z-index: 15000;
        display: flex; justify-content: center; align-items: center; backdrop-filter: blur(8px);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    `;

    modal.innerHTML = `
        <div style="background:#0a0a0a; border:2px solid #00e5ff; border-radius:12px; padding:30px; width:90%; max-width:550px; box-shadow:0 0 30px rgba(0,229,255,0.25); color:#fff; position:relative; max-height:95vh; overflow-y:auto;">
            <h2 style="color:#ffe600; text-transform:uppercase; text-align:center; margin-top:0; font-size:20px; letter-spacing:1px;">Account & Credentials Verification</h2>
            
            <div style="background:#121212; border-left:4px solid #ff4081; padding:12px; border-radius:6px; margin-bottom:15px; font-size:13px; line-height:1.4;">
                <b style="color:#ff4081;">Important Notice:</b> Keep your <b>Reference / Coupon Number</b> safe! It is your primary point of reference whenever you contact us for any help or support.
            </div>

            <div style="background:#151515; border:1px solid #222; padding:15px; border-radius:6px; margin-bottom:15px;">
                <p style="margin:0 0 10px 0; font-size:14px; color:#ccc;">Please verify your details:</p>
                
                <div style="margin-bottom:10px; font-size:14px; display:flex; justify-content:space-between; align-items:center; background:#111; padding:8px 10px; border-radius:4px; border:1px solid #333;">
                    <strong>Reference / Coupon No:</strong> 
                    <span id="verifyCouponCodeDisplay" style="color:#00e5ff; font-family:monospace; font-weight:bold;">${escapeHtml(paymentData.reference)}</span>
                </div>

                <div style="margin-bottom:8px; font-size:14px; display:flex; justify-content:space-between; align-items:center;">
                    <strong>Student Name:</strong> <span id="verifyNameDisplay" style="color:#00e5ff;">${escapeHtml(paymentData.studentName)}</span>
                </div>

                <div style="margin-bottom:8px; font-size:14px; display:flex; justify-content:space-between; align-items:center;">
                    <strong>Email Address:</strong> <span id="verifyEmailDisplay" style="color:#00e5ff;">${escapeHtml(paymentData.email)}</span>
                </div>

                <div style="margin-bottom:12px; font-size:14px; display:flex; justify-content:space-between; align-items:center;">
                    <strong>WhatsApp Phone:</strong> <span id="verifyPhoneDisplay" style="color:#00e5ff;">${escapeHtml(paymentData.whatsapp)}</span>
                </div>

                <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #222; padding-top:10px;">
                    <span style="font-size:12px; color:#888;">Is this correct?</span>
                    <button type="button" id="payChangeInfoBtn" style="background:transparent; border:1px solid #ffe600; color:#ffe600; padding:6px 12px; border-radius:4px; font-size:12px; font-weight:bold; cursor:pointer; text-transform:uppercase;">Change Now</button>
                </div>
            </div>

            <p style="font-size:11px; color:#777; margin-bottom:15px; font-style:italic; text-align:center;">
                Note: You can only change these details in the future via email or phone call with a valid explanation.
            </p>

            <div style="margin-bottom:15px;">
                <button type="button" id="paySaveCredsBtn" style="width:100%; background:transparent; border:2px dashed #ffe600; color:#ffe600; padding:10px; font-weight:bold; font-size:13px; border-radius:6px; cursor:pointer; text-transform:uppercase;">
                    📥 Save Credentials to Device (TXT File)
                </button>
            </div>

            <div style="margin-bottom:20px; display:flex; align-items:flex-start; gap:10px; background:#111; padding:12px; border-radius:6px; border:1px solid #333;">
                <input type="checkbox" id="confirmInfoCheckbox" style="margin-top:3px; width:18px; height:18px; accent-color:#00e5ff; cursor:pointer;">
                <label for="confirmInfoCheckbox" style="font-size:13px; color:#ddd; cursor:pointer; line-height:1.4;">
                    I confirm that all information provided is correct and understand the reference and modification policies.
                </label>
            </div>

            <button type="button" id="payProceedArenaBtn" style="width:100%; background:#00e5ff; color:#050505; border:none; padding:14px; font-weight:bold; font-size:15px; border-radius:6px; cursor:pointer; text-transform:uppercase; letter-spacing:1px; box-shadow:0 0 15px rgba(0,229,255,0.4);">
                OK / PROCEED TO ARENA
            </button>
        </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('payChangeInfoBtn').onclick = () => openChangeInfoModalFromVerification(paymentData);
    document.getElementById('paySaveCredsBtn').onclick = () => saveCredentialsAsFile(paymentData);
    document.getElementById('payProceedArenaBtn').onclick = () => handleVerificationSubmit(paymentData);
}

function openChangeInfoModalFromVerification(paymentData) {
    let existing = document.getElementById('customChangeModal');
    if (existing) existing.remove();

    const changeModal = document.createElement('div');
    changeModal.id = 'customChangeModal';
    changeModal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(5,5,5,0.85); z-index: 18000;
        display: flex; justify-content: center; align-items: center; backdrop-filter: blur(5px);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    `;

    changeModal.innerHTML = `
        <div style="background:#0e0e0e; border:2px solid #00e5ff; border-radius:10px; padding:25px; width:90%; max-width:450px; color:#fff;">
            <h3 style="color:#ffe600; margin-top:0; text-transform:uppercase; font-size:18px; text-align:center;">Update Contact Details</h3>
            
            <div style="margin-bottom:12px;">
                <label style="display:block; font-size:13px; color:#aaa; margin-bottom:4px;">Student Name:</label>
                <input type="text" id="modalInputName" value="${escapeHtml(paymentData.studentName)}" oninput="this.value = this.value.toUpperCase()" style="width:100%; padding:10px; background:#181818; border:1px solid #00e5ff; color:#fff; border-radius:5px; box-sizing:border-box; outline:none;">
            </div>

            <div style="margin-bottom:12px;">
                <label style="display:block; font-size:13px; color:#aaa; margin-bottom:4px;">Email Address:</label>
                <input type="email" id="modalInputEmail" value="${escapeHtml(paymentData.email)}" style="width:100%; padding:10px; background:#181818; border:1px solid #00e5ff; color:#fff; border-radius:5px; box-sizing:border-box; outline:none;">
            </div>

            <div style="margin-bottom:15px;">
                <label style="display:block; font-size:13px; color:#aaa; margin-bottom:4px;">WhatsApp Number (International Standard):</label>
                <input type="text" id="modalInputPhone" value="${escapeHtml(paymentData.whatsapp)}" placeholder="+233241234567" style="width:100%; padding:10px; background:#181818; border:1px solid #00e5ff; color:#fff; border-radius:5px; box-sizing:border-box; outline:none;">
                <small style="display:block; font-size:11px; color:#ffe600; margin-top:4px; line-height:1.4;">
                    Must start with '+' followed by country code.<br>
                    Examples: <strong>+233241234567</strong>, <strong>+14155552671</strong>
                </small>
            </div>

            <div style="display:flex; gap:10px;">
                <button type="button" id="savePayChangeBtn" style="flex:1; background:#00e5ff; color:#050505; border:none; padding:10px; font-weight:bold; border-radius:5px; cursor:pointer; text-transform:uppercase;">Save Changes</button>
                <button type="button" id="cancelPayChangeBtn" style="flex:1; background:transparent; border:1px solid #555; color:#aaa; padding:10px; font-weight:bold; border-radius:5px; cursor:pointer; text-transform:uppercase;">Cancel</button>
            </div>
        </div>
    `;

    document.body.appendChild(changeModal);

    document.getElementById('savePayChangeBtn').onclick = () => {
        const newName = document.getElementById('modalInputName').value.trim().toUpperCase();
        const newEmail = document.getElementById('modalInputEmail').value.trim();
        const newPhone = document.getElementById('modalInputPhone').value.trim();

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const internationalPhoneRegex = /^\+[1-9]\d{7,14}$/;

        if (!newName) {
            showColorfulAlert("Please enter a valid student name.", "Validation Error");
            return;
        }

        if (!emailRegex.test(newEmail)) {
            showColorfulAlert("Please enter a valid email address format (e.g. user@example.com).", "Validation Error");
            return;
        }

        if (!internationalPhoneRegex.test(newPhone)) {
            showColorfulAlert("Invalid WhatsApp Phone Number format! Must start with '+' followed by country code and number.\n\nExamples:\n• +233241234567 (Ghana)\n• +14155552671 (USA)", "International Standard Error");
            return;
        }

        paymentData.studentName = newName;
        paymentData.email = newEmail;
        paymentData.whatsapp = newPhone;

        document.getElementById('verifyNameDisplay').innerText = newName;
        document.getElementById('verifyEmailDisplay').innerText = newEmail;
        document.getElementById('verifyPhoneDisplay').innerText = newPhone;

        changeModal.remove();
        showColorfulAlert("Contact details updated successfully.", "Success");
    };

    document.getElementById('cancelPayChangeBtn').onclick = () => changeModal.remove();
}

function saveCredentialsAsFile(data) {
    const fileContent = `========================================\n` +
                        `BRIGHT & BOLD - ACCOUNT CREDENTIALS\n` +
                        `========================================\n` +
                        `Reference / Coupon No : ${data.reference}\n` +
                        `Student Name          : ${data.studentName}\n` +
                        `Email Address         : ${data.email}\n` +
                        `WhatsApp Number       : ${data.whatsapp}\n` +
                        `========================================\n` +
                        `Keep this file safe! It is your primary reference for support.\n`;

    const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `BrightAndBold_Credentials_${data.reference}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function handleVerificationSubmit(paymentData) {
    const checkbox = document.getElementById('confirmInfoCheckbox');
    if (!checkbox.checked) {
        showColorfulAlert("Please check the confirmation box to confirm your information is correct before proceeding.", "Required Confirmation");
        return;
    }

    showColorfulAlert("Are you sure? Once verified, your credentials will be locked for standard access and posted to the server.", "Final Confirmation", async (confirmed) => {
        if (confirmed) {
            const modal = document.getElementById('userVerificationModal');
            if (modal) modal.remove();

            await finalizeSubscriptionActivation(paymentData);
        }
    }, true);
}

async function finalizeSubscriptionActivation(payloadData) {
    const autoSchoolCode = "ONLINE-DIRECT";
    const autoProductCode = payloadData.reference;
    const resolvedStudentName = (payloadData.studentName || "").toUpperCase();

    let calculatedExpiry = Date.now() + (30 * 24 * 60 * 60 * 1000);
    if (payloadData.planType.includes('6month')) {
        calculatedExpiry = Date.now() + (180 * 24 * 60 * 60 * 1000);
    } else if (payloadData.planType.includes('year')) {
        calculatedExpiry = Date.now() + (365 * 24 * 60 * 60 * 1000);
    }

    localStorage.removeItem('bb_continuous_session_data');
    localStorage.removeItem('bb_last_active_timestamp');
    localStorage.removeItem('bb_session_start_timestamp');
    sessionStorage.clear();

    localStorage.setItem('mrelorm_subscriber', 'true');
    localStorage.setItem('mrelorm_email', payloadData.email);
    localStorage.setItem('mrelorm_ref', payloadData.reference);
    localStorage.setItem('mrelorm_plan', autoProductCode);
    localStorage.setItem('mrelorm_product_code', autoProductCode);
    localStorage.setItem('mrelorm_expiry', calculatedExpiry);
    localStorage.setItem('schoolCode', autoSchoolCode);
    localStorage.setItem('studentName', resolvedStudentName);
    sessionStorage.setItem('currentStudentName', resolvedStudentName);

    const fullPayload = {
        email: payloadData.email,
        plan: payloadData.planName,
        planType: payloadData.planType,
        studentName: resolvedStudentName,
        whatsapp: payloadData.whatsapp,
        schoolCode: autoSchoolCode,
        productCode: autoProductCode
    };

    let unlockingOverlay = document.createElement('div');
    unlockingOverlay.id = 'arenaUnlockingOverlay';
    unlockingOverlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(5, 5, 5, 0.94); z-index: 999999;
        display: flex; flex-direction: column; justify-content: center; align-items: center;
        backdrop-filter: blur(10px); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        text-align: center; padding: 20px;
    `;
    unlockingOverlay.innerHTML = `
        <div style="
            width: 80px; height: 80px; border-radius: 50%;
            border: 6px solid #1a1a1a;
            border-top: 6px solid #00ff00;
            border-right: 6px solid #00e5ff;
            border-bottom: 6px solid #ffe600;
            animation: spin 0.8s linear infinite;
            box-shadow: 0 0 35px rgba(0, 255, 0, 0.5);
            margin-bottom: 25px;
        "></div>
        <h2 style="color: #ffe600; text-transform: uppercase; font-size: 22px; letter-spacing: 2px; margin-bottom: 10px; text-shadow: 0 0 10px rgba(255,230,0,0.4);">Unlocking Learning Arena...</h2>
        <p style="color: #00e5ff; font-size: 15px; font-family: monospace; letter-spacing: 1px; margin-bottom: 5px;">Synchronizing secure subscription with server</p>
        <p style="color: #888; font-size: 12px; font-style: italic;">Please hold on while your portal is being prepared.</p>
    `;
    document.body.appendChild(unlockingOverlay);

    try {
        const res = await fetch(`${API_BASE_URL}/api/activate-subscription`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fullPayload)
        });
        const result = await res.json();
        
        if (result.sessionToken) {
            localStorage.setItem('mrelorm_session_token', result.sessionToken);
        }
        if (result.expiryDate) {
            calculatedExpiry = new Date(result.expiryDate).getTime();
            localStorage.setItem('mrelorm_expiry', calculatedExpiry);
        }
        localStorage.removeItem('mrelorm_pending_sync');
    } catch (err) {
        console.warn('Server offline during activation. Saving sync queue locally:', err);
        localStorage.setItem('mrelorm_pending_sync', JSON.stringify(fullPayload));
    }

    await new Promise(resolve => setTimeout(resolve, 1500));
    unlockingOverlay.remove();

    showCustomPopup("Success", "Full learning arena access is now unlocked and registered!", "success", () => {
        if (typeof AuthState !== 'undefined' && AuthState.initUI) {
            AuthState.initUI();
        }
        window.location.reload();
    });
}

/**
 * Securely verify student subscription access against the PostgreSQL backend.
 */
async function verifyStudentAccess() {
    const productCode = localStorage.getItem('mrelorm_plan') || localStorage.getItem('bb_product_code') || localStorage.getItem('mrelorm_product_code');
    const schoolCode = localStorage.getItem('schoolCode') || 'ONLINE-DIRECT';
    const sessionToken = localStorage.getItem('mrelorm_session_token');
    const isLocalSubscriber = localStorage.getItem('mrelorm_subscriber') === 'true';

    if (!isLocalSubscriber || !productCode) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/verify-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productCode: productCode, schoolCode: schoolCode, sessionToken: sessionToken || 'paystack_active_grace' })
        });
        
        const result = await response.json();

        if (!response.ok || !result.success || !result.active) {
            console.warn("Security Alert: Specific subscription product code inactive or reset. Purging user session.");
            purgeLocalStorageSession();
            if (typeof AuthState !== 'undefined' && AuthState.initUI) {
                AuthState.initUI();
            }
        }
    } catch (err) {
        console.warn("Access verification network warning (running in offline grace):", err);
    }
}

function purgeLocalStorageSession() {
    localStorage.removeItem('mrelorm_session_token'); 
    localStorage.removeItem('mrelorm_subscriber');
    localStorage.removeItem('mrelorm_email');
    localStorage.removeItem('mrelorm_ref');
    localStorage.removeItem('mrelorm_plan');
    localStorage.removeItem('mrelorm_product_code');
    localStorage.removeItem('mrelorm_expiry');
    localStorage.removeItem('mrelorm_session_verified');
    localStorage.removeItem('schoolCode');
    localStorage.removeItem('studentName');
    localStorage.removeItem('bb_student_email');
    localStorage.removeItem('bb_product_code');
    localStorage.removeItem('bb_student_name');
    localStorage.removeItem('bb_continuous_session_data');
    localStorage.removeItem('bb_last_active_timestamp');
    localStorage.removeItem('bb_session_start_timestamp');
    sessionStorage.clear();
}

async function syncPendingData() {
    const pending = localStorage.getItem('mrelorm_pending_sync');
    if (!pending) return;

    try {
        const payload = JSON.parse(pending);
        const res = await fetch(`${API_BASE_URL}/api/activate-subscription`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            console.log("Pending offline subscription successfully synced to server!");
            localStorage.removeItem('mrelorm_pending_sync');
        }
    } catch (e) {
        console.warn("Server still offline. Will retry sync later.");
    }
}

const init = () => {
    console.log("System Ready.");
    
    verifyStudentAccess();
    syncPendingData();

    const savedName = localStorage.getItem('studentName');
    const nameInput = document.getElementById('studentName');
    if (savedName && nameInput) {
        nameInput.value = savedName;
    }

    updateDynamicHeader();
    AuthState.initUI();

    const urlParams = new URLSearchParams(window.location.search);
    const subject = urlParams.get('subject');
    const activity = urlParams.get('activity');
    const grade = urlParams.get('grade');
    const curriculum = urlParams.get('curriculum');
    const subjectTitle = document.getElementById('subject-title');

    if (subjectTitle) {
        let titleText = subject ? subject.replace('-', ' ').toUpperCase() : "Learning Arena";
        if (activity) titleText += ` - ${activity.toUpperCase()}`;
        if (grade) titleText += ` - ${grade.toUpperCase()}`;
        subjectTitle.textContent = titleText;
    }

    if (window.location.pathname.includes('grade-menu.html')) {
        const cleanCurriculum = (curriculum && curriculum !== 'null') ? curriculum : 'cambridge';
        const gradeGrid = document.querySelector('.selection-grid');
        const config = {
            'cambridge': [
                { id: 'yr7', label: 'YEAR 7 🟡' },
                { id: 'yr8', label: 'YEAR 8 🔵' },
                { id: 'yr9', label: 'YEAR 9 🔴' },
                { id: 'igcse', label: 'GCSE 🟢' },
                { id: 'a-level', label: 'A-LEVEL 🟡' }
            ],
            'wassce': [
                { id: 'ss1', label: 'S.H.S 1 📚' },
                { id: 'ss2', label: 'S.H.S 2 📗' },
                { id: 'ss3', label: 'S.H.S 3 🎓' }
            ],
            'bece': [
                { id: 'jhs1', label: 'J.H.S 1 📚' },
                { id: 'jhs2', label: 'J.H.S 2 📗' },
                { id: 'jhs3', label: 'J.H.S 3 🎓' }
            ],
            'pearson': [
                { id: 'yr7', label: 'YEAR 7 🟡' },
                { id: 'yr8', label: 'YEAR 8 🔵' },
                { id: 'yr9', label: 'YEAR 9 🔴' },
                { id: 'igcse-pearson', label: 'IGCSE 📝' },
                { id: 'ial', label: 'INT. A-LEVEL 🎓' }
            ],
            'american': [
                { id: 'g6', label: 'GRADE 6 🎒' },
                { id: 'g7', label: 'GRADE 7 🎒' },
                { id: 'g8', label: 'GRADE 8 🎒' },
                { id: 'g9', label: 'GRADE 9 🎓' },
                { id: 'g10', label: 'GRADE 10 🎓' },
                { id: 'g11', label: 'GRADE 11 🎓' },
                { id: 'g12', label: 'GRADE 12 🎓' }
            ]
        };

        const levels = config[cleanCurriculum];
        if (levels && gradeGrid) {
            gradeGrid.innerHTML = '';
            levels.forEach(level => {
                const btn = document.createElement('button');
                btn.className = 'btn-activity';
                btn.textContent = level.label;
                btn.onclick = () => selectGrade(level.id);
                gradeGrid.appendChild(btn);
            });
        }
    }
};

const updateDynamicHeader = () => {
    const welcomeHeader = document.getElementById('welcome-message');
    if (!welcomeHeader) return;

    const name = sessionStorage.getItem("currentStudentName") || localStorage.getItem('studentName') || "Student";
    const subject = sessionStorage.getItem("currentSubject") || "";
    const curriculum = sessionStorage.getItem("currentCurriculum") || "";
    
    const urlParams = new URLSearchParams(window.location.search);
    const activity = urlParams.get('activity') || "";
    const cat = urlParams.get('cat') || ""; 
    
    let context = "";
    if (activity) context += ` ${activity.toUpperCase()}`;
    if (cat) {
        const parts = cat.split('-');
        const grade = parts[parts.length - 1]; 
        context += ` ${grade.toUpperCase()}`;
    }

    const display = `${curriculum.toUpperCase()} ${subject.toUpperCase()}${context}`.trim();
    welcomeHeader.innerHTML = `Welcome, ${escapeHtml(name)}!<br><small style="color: #00e5ff; font-weight: bold; letter-spacing: 1px;">${escapeHtml(display)}</small>`;
};

document.addEventListener('DOMContentLoaded', () => {
    init();
});

function handleDynamicUnlock() {
    const isSubscriber = localStorage.getItem('mrelorm_subscriber') === 'true';
    const expiryDate = localStorage.getItem('mrelorm_expiry');
    const isExpired = expiryDate && Date.now() > parseInt(expiryDate);

    if (isSubscriber && !isExpired) {
        window.location.href = window.location.pathname.includes('templates') ? 'subscription-details.html' : 'templates/subscription-details.html';
    } else {
        if (typeof window.openUnlockChoiceModal === 'function') {
            window.openUnlockChoiceModal();
        } else {
            unlockFullAccess();
        }
    }
}

async function enterArena() {
    try {
        if (typeof verifyStudentAccess === 'function') {
            await verifyStudentAccess();
        }
    } catch (e) {
        console.warn("Skipping access verification during offline mode:", e);
    }

    const nameInput = document.getElementById('studentName');
    const subjectSelect = document.getElementById('subjectSelect');
    const curriculumSelect = document.getElementById('curriculumSelect');

    if (!nameInput) {
        showCustomPopup("Error", "Student name input not found!", "error");
        console.error("enterArena error: Student name input element not found in DOM.");
        return;
    }

    const name = nameInput.value.trim().toUpperCase();
    let subject = subjectSelect ? subjectSelect.value : 'physics';
    const curriculum = curriculumSelect ? curriculumSelect.value : 'cambridge';

    const nameRegex = /^[a-zA-Z0-9\s'_@-]+$/;
    
    if (!name) { 
        showCustomPopup("Input Required", "Please enter your name or email!", "error");
        nameInput.focus();
        return; 
    }
    if (!nameRegex.test(name)) {
        showCustomPopup("Invalid Format", "Please enter a valid name (letters, numbers, underscores, and @ allowed).", "error");
        nameInput.focus(); 
        return; 
    }

    if (!subject) { 
        showCustomPopup("Selection Required", "Please choose a subject!", "error");
        return; 
    }
    if (!curriculum) { 
        showCustomPopup("Selection Required", "Please choose a curriculum!", "error");
        return; 
    }

    if (subject === 'integrated-science' && curriculum !== 'bece' && curriculum !== 'wassce') {
        const messageArea = document.getElementById('system-message');
        if (messageArea) {
            messageArea.innerHTML = "⚠️ Integrated Science is available for BECE and WASSCE curricula only.";
            messageArea.className = "system-alert";
            messageArea.style.color = "#ff4081";
        }
        return;
    }

    if (curriculum === 'bece' && (subject === 'biology' || subject === 'chemistry' || subject === 'physics')) {
        subject = 'integrated-science';
    }

    sessionStorage.setItem("currentStudentName", name);
    sessionStorage.setItem("currentSubject", subject);
    sessionStorage.setItem("currentCurriculum", curriculum);
    localStorage.setItem('studentName', name);

    // Instantiation and login alert handled cleanly by SessionTracker constructor guard
    const isSubscriber = localStorage.getItem('mrelorm_subscriber') === 'true';
    const activeProductCode = localStorage.getItem('mrelorm_plan') || localStorage.getItem('mrelorm_product_code');
    if (isSubscriber && activeProductCode && typeof SessionTracker !== 'undefined') {
        if (!globalSessionTracker) {
            globalSessionTracker = new SessionTracker(activeProductCode);
        } else {
            globalSessionTracker.studentName = name;
        }
    }

    if (globalSessionTracker && typeof globalSessionTracker.setSubject === 'function') {
        globalSessionTracker.setSubject(subject);
        if (typeof globalSessionTracker.syncSilently === 'function') {
            globalSessionTracker.syncSilently().catch(() => {});
        }
    }

    sessionStorage.setItem('bb_is_internal_navigation', 'true');
    window.location.href = `templates/activity-menu.html?subject=${subject}&curriculum=${curriculum}`;
}

window.enterArena = enterArena;
window.checkCurriculum = checkCurriculum;

function selectActivity(activity) {
    const urlParams = new URLSearchParams(window.location.search);
    
    const subject = urlParams.get('subject') || sessionStorage.getItem("currentSubject");
    const curriculum = urlParams.get('curriculum') || sessionStorage.getItem("currentCurriculum");

    if (!subject || !curriculum) {
        showCustomPopup("Session Lost", "Session lost. Please return to Home.", "error", () => {
            window.location.href = "../index.html";
        });
        return;
    }

    if (globalSessionTracker && typeof globalSessionTracker.setActivityType === 'function') {
        globalSessionTracker.setActivityType(activity);
        if (typeof globalSessionTracker.syncSilently === 'function') {
            globalSessionTracker.syncSilently().catch(() => {});
        }
    }

    sessionStorage.setItem('bb_is_internal_navigation', 'true');
    window.location.href = `grade-menu.html?subject=${subject}&activity=${activity}&curriculum=${curriculum}`;
}

function checkCurriculum() {
    const subjectSelect = document.getElementById('subjectSelect');
    const curriculumSelect = document.getElementById('curriculumSelect');
    const messageArea = document.getElementById('system-message');
    
    if (!subjectSelect || !curriculumSelect) {
        return false;
    }

    if (messageArea) {
        messageArea.innerHTML = '';
        messageArea.className = '';
        messageArea.style.color = '';
    }

    if (subjectSelect.value === 'integrated-science' && curriculumSelect.value && curriculumSelect.value !== 'bece' && curriculumSelect.value !== 'wassce') {
        if (messageArea) {
            messageArea.innerHTML = "⚠️ Integrated Science is available for BECE and WASSCE curricula only.";
            messageArea.className = "system-alert";
            messageArea.style.color = "#ff4081";
        }
        return false;
    }

    if (curriculumSelect.value === 'bece') {
        if (['biology', 'chemistry', 'physics'].includes(subjectSelect.value)) {
            subjectSelect.value = 'integrated-science';
            if (messageArea) {
                messageArea.textContent = "BECE uses Integrated Science. Subject automatically updated!";
                messageArea.className = "system-alert";
                setTimeout(() => { 
                    messageArea.textContent = ""; 
                    messageArea.className = ""; 
                }, 4000);
            }
        }
    }
    
    return true;
}

function selectGrade(level) {
    const urlParams = new URLSearchParams(window.location.search);
    
    const subject = urlParams.get('subject') || sessionStorage.getItem("currentSubject");
    const activity = urlParams.get('activity') || "worksheets"; 
    const curriculum = urlParams.get('curriculum') || sessionStorage.getItem("currentCurriculum");

    const gradeMap = {
        'yr7': 'year-7',
        'yr8': 'year-8',
        'yr9': 'year-9',
        'igcse': 'igcse', 
        'gcse': 'igcse',
        'gr6': 'grade-6',
        'jhs1': 'jhs-1',
        'jhs2': 'jhs-2',
        'jhs3': 'jhs-3',
        'ss1': 'shs-1',
        'ss2': 'shs-2',
        'ss3': 'shs-3',
        "shs-1": "shs1",
        "shs-2": "shs2",
        "shs-3": "shs3",
        "a-level": 'alevel'
    };

    const finalLevel = gradeMap[level] || level;

    if (!subject || !curriculum) {
        showCustomPopup("Navigation Error", "Navigation context lost. Redirecting to home.", "error", () => {
            window.location.href = "../index.html";
        });
        return;
    }

    const cat = `${subject}|${curriculum}|${activity}|${finalLevel}`;
    sessionStorage.setItem('bb_is_internal_navigation', 'true');
    window.location.href = `selector-hub.html?cat=${cat}`;
}

document.addEventListener('keydown', function(event) {
    if (event.key === 'Backspace') {
        const activeElement = document.activeElement;
        const isInput = activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA';
        
        if (!isInput) {
            const backBtn = document.querySelector('.btn-back');
            if (backBtn) {
                backBtn.click();
            } else {
                window.history.back();
            }
        }
    }
});

const MemoryManager = {
    clearStage: function() {
        const canvas = document.querySelector('canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        console.log("Stage memory cleared.");
    }
};

window.onload = function() {
    const subjectSelect = document.getElementById('subjectSelect');
    const curriculumSelect = document.getElementById('curriculumSelect');

    if (subjectSelect) subjectSelect.value = 'physics';
    if (curriculumSelect) curriculumSelect.value = 'cambridge';

    if (typeof checkCurriculum === 'function') {
        checkCurriculum();
    }
};

const PAYSTACK_PUBLIC_KEY = 'pk_test_588528bf96b6d0e1025c96eb994b7666e3043e28';

function unlockFullAccess() {
    if (typeof window.openUnlockChoiceModal === 'function') {
        window.openUnlockChoiceModal();
        return;
    }

    let choiceModal = document.getElementById('unlockChoiceModal');
    if (!choiceModal) {
        choiceModal = document.createElement('div');
        choiceModal.id = 'unlockChoiceModal';
        choiceModal.style.cssText = `
            position: fixed;
            top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(5, 5, 5, 0.85);
            backdrop-filter: blur(8px);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 999999;
            font-family: inherit;
        `;
        choiceModal.innerHTML = `
            <div style="
                background: #0a0a0a;
                border: 2px solid #ffe600;
                box-shadow: 0 0 25px rgba(255, 230, 0, 0.3);
                border-radius: 16px;
                padding: 30px;
                width: 90%;
                max-width: 420px;
                text-align: center;
                animation: modalPop 0.3s ease-out;
            ">
                <h3 style="color: #ffe600; margin-top: 0; font-size: 1.4rem; letter-spacing: 1px; text-transform: uppercase;">Choose Access Method</h3>
                <p style="color: #ccc; font-size: 0.9rem; margin-bottom: 20px;">Select how you would like to unlock full learning arena access:</p>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    <button onclick="closeChoiceModal(); if (window.openSubscriberTypeModal) { window.openSubscriberTypeModal('online'); } else { openSubModalFromHub(); }" style="padding: 12px; background: #00e5ff; color: #050505; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; text-transform: uppercase; font-size: 13px;">Online Registration (Packages)</button>
                    <button onclick="closeChoiceModal(); window.location.href = window.location.pathname.includes('templates') ? '../index.html#buyCoupon' : '#buyCoupon';" style="padding: 12px; background: #00ff00; color: #050505; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; text-transform: uppercase; font-size: 13px;">Buy Coupon</button>
                    <button onclick="closeChoiceModal(); if (window.openSubscriberTypeModal) { window.openSubscriberTypeModal('coupon'); } else if (window.openCouponModal) { window.openCouponModal(); } else { window.location.href='index.html'; }" style="padding: 12px; background: transparent; color: #ff4081; border: 2px solid #ff4081; border-radius: 8px; font-weight: bold; cursor: pointer; text-transform: uppercase; font-size: 13px;">Redeem Coupon</button>
                    <button onclick="closeChoiceModal()" style="padding: 10px; background: #333; color: #fff; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; text-transform: uppercase; font-size: 12px; margin-top: 5px;">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(choiceModal);
    }

    choiceModal.style.display = 'flex';
}

function closeChoiceModal() {
    const choiceModal = document.getElementById('unlockChoiceModal');
    if (choiceModal) {
        choiceModal.style.display = 'none';
    }
}
window.closeChoiceModal = closeChoiceModal;

function openSubModalFromHub() {
    closeChoiceModal();
    const subModal = document.getElementById('subModal');
    if (subModal) {
        subModal.style.display = 'flex';
    }
}
window.openSubModalFromHub = openSubModalFromHub;

function closeSubModal() {
    const modal = document.getElementById('subModal');
    if (modal) {
        modal.style.display = 'none';
    }
}
window.closeSubModal = closeSubModal;

function deleteAccount() {
    let existingOverlay = document.getElementById('brightDeleteOverlay');
    if (existingOverlay) existingOverlay.remove();

    const overlay = document.createElement('div');
    overlay.id = 'brightDeleteOverlay';
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
    card.id = 'brightDeleteCard';
    card.style.cssText = `
        background: #0a0a0a;
        border: 2px solid #ff4081;
        box-shadow: 0 0 25px rgba(255, 64, 129, 0.4);
        border-radius: 16px;
        padding: 30px;
        width: 90%;
        max-width: 420px;
        text-align: center;
        animation: modalPop 0.3s ease-out;
        color: #fff;
    `;

    card.innerHTML = `
        <h3 style="color: #ff4081; margin-top: 0; font-size: 1.4rem; letter-spacing: 1px; text-transform: uppercase;">Delete Account</h3>
        <p style="color: #ffffff; font-size: 1rem; line-height: 1.6; margin-bottom: 20px;">
            Are you sure? Deleted accounts cannot be restored.<br><br>
            <small style="color: #ffe600; font-style: italic;">Terms and conditions apply.</small>
        </p>
        <div style="display: flex; gap: 12px; justify-content: center;">
            <button id="deleteCancelBtn" style="
                flex: 1; padding: 12px; background: #333; color: #ffffff; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; text-transform: uppercase; letter-spacing: 1px;
            ">Cancel</button>
            <button id="deleteConfirmBtn" style="
                flex: 1; padding: 12px; background: #ff4081; color: #ffffff; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; text-transform: uppercase; letter-spacing: 1px;
            ">Delete</button>
        </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    document.getElementById('deleteCancelBtn').onclick = () => {
        overlay.remove();
    };

    document.getElementById('deleteConfirmBtn').onclick = async () => {
        card.innerHTML = `
            <div style="font-size: 2.5rem; margin-bottom: 15px;">⏳</div>
            <h3 style="color: #ffe600; margin-top: 0; font-size: 1.3rem; letter-spacing: 1px; text-transform: uppercase;">Deleting Account...</h3>
            <p style="color: #ccc; font-size: 0.95rem; line-height: 1.6; margin-bottom: 20px;">
                Please wait while we securely process your account deletion and sync with the server.
            </p>
        `;

        const email = localStorage.getItem('mrelorm_email');
        const productCode = localStorage.getItem('mrelorm_product_code') || localStorage.getItem('mrelorm_plan');
        if (email || productCode) {
            try {
                await fetch(`${API_BASE_URL}/api/delete-account`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, productCode })
                });
            } catch (err) {
                console.error('Failed to notify backend of account deletion:', err);
            }
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        purgeLocalStorageSession();

        card.innerHTML = `
            <div style="font-size: 2.5rem; margin-bottom: 15px;">🎉</div>
            <h3 style="color: #00ff00; margin-top: 0; font-size: 1.3rem; letter-spacing: 1px; text-transform: uppercase;">Account Deleted</h3>
            <p style="color: #fff; font-size: 0.95rem; line-height: 1.6; margin-bottom: 20px;">
                Your account has been successfully deleted.
            </p>
            <button id="deleteCompleteOkBtn" style="
                width: 100%; padding: 12px; background: #00ff00; color: #050505; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; font-size: 13px;
            ">OK</button>
        `;

        document.getElementById('deleteCompleteOkBtn').onclick = () => {
            overlay.remove();
            window.location.reload();
        };
    };
}

function showSubscriptionModalFlow(planType, amountInPesewas, planName, currency = 'GHS') {
    closeSubModal();
    let existingOverlay = document.getElementById('brightEmailPromptOverlay');
    if (existingOverlay) existingOverlay.remove();

    const overlay = document.createElement('div');
    overlay.id = 'brightEmailPromptOverlay';
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
        box-shadow: 0 0 25px rgba(0, 229, 255, 0.3);
        border-radius: 16px;
        padding: 25px;
        width: 90%;
        max-width: 450px;
        text-align: center;
        animation: modalPop 0.3s ease-out;
        max-height: 90vh;
        overflow-y: auto;
    `;

    card.innerHTML = `
        <h3 style="color: #ffe600; margin-top: 0; font-size: 1.3rem; letter-spacing: 1px; text-transform: uppercase;">🌐 Online Registration Portal</h3>
        <p style="color: #ccc; font-size: 0.85rem; line-height: 1.4; margin-bottom: 12px;">
            Registering for: <b style="color: #00ff00;">${escapeHtml(planName)}</b>
        </p>
        <div id="brightPromptError" style="color: #ff4081; font-size: 0.8rem; margin-bottom: 10px; font-weight: bold; display: none;"></div>
        
        <div id="modalInputArea" style="text-align: left;">
            <div style="margin-bottom: 10px;">
                <label style="color: #fff; font-size: 12px; display: block; margin-bottom: 3px; font-family: monospace;">Student Name</label>
                <input type="text" id="brightPromptStudentName" placeholder="e.g. John Doe" oninput="this.value = this.value.toUpperCase()" style="width: 100%; padding: 10px; background: #121212; border: 1px solid #00e5ff; color: #fff; border-radius: 6px; font-size: 13px; box-sizing: border-box;">
            </div>
            <div style="margin-bottom: 10px;">
                <label style="color: #fff; font-size: 12px; display: block; margin-bottom: 3px; font-family: monospace;">Email Address</label>
                <input type="email" id="brightPromptEmailInput" placeholder="student@example.com" style="width: 100%; padding: 10px; background: #121212; border: 1px solid #00e5ff; color: #fff; border-radius: 6px; font-size: 13px; box-sizing: border-box;">
            </div>
            <div style="margin-bottom: 10px;">
                <label style="color: #fff; font-size: 12px; display: block; margin-bottom: 3px; font-family: monospace;">Confirm Email Address</label>
                <input type="email" id="brightPromptEmailConfirmInput" placeholder="student@example.com" style="width: 100%; padding: 10px; background: #121212; border: 1px solid #00e5ff; color: #fff; border-radius: 6px; font-size: 13px; box-sizing: border-box;">
            </div>
            <div style="margin-bottom: 10px;">
                <label style="color: #fff; font-size: 12px; display: block; margin-bottom: 3px; font-family: monospace;">WhatsApp Contact Number</label>
                <input type="text" id="regWhatsapp" placeholder="e.g. +233241234567" style="width: 100%; padding: 10px; background: #121212; border: 1px solid #00e5ff; color: #fff; border-radius: 6px; font-size: 13px; box-sizing: border-box;">
            </div>
            <div style="margin-bottom: 15px;">
                <label style="color: #fff; font-size: 12px; display: block; margin-bottom: 3px; font-family: monospace;">Confirm WhatsApp Contact Number</label>
                <input type="text" id="regWhatsappConfirm" placeholder="e.g. +233241234567" style="width: 100%; padding: 10px; background: #121212; border: 1px solid #00e5ff; color: #fff; border-radius: 6px; font-size: 13px; box-sizing: border-box;">
                <small style="color: #888; font-size: 10px; display: block; margin-top: 4px;">Enter with country code. Examples: <strong>+233241234567</strong>, <strong>+14155552671</strong></small>
            </div>

            <div style="display: flex; gap: 10px; margin-top: 15px;">
                <button id="brightPromptBackBtn" style="flex: 1; padding: 10px; background: #333; color: #ffffff; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; text-transform: uppercase; font-size: 12px;">Back</button>
                <button id="brightPromptOkBtn" style="flex: 1; padding: 10px; background: #00ff00; color: #050505; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; text-transform: uppercase; font-size: 12px;">Proceed to Pay</button>
            </div>
        </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const nameInput = document.getElementById('brightPromptStudentName');
    const emailInput = document.getElementById('brightPromptEmailInput');
    const emailConfirmInput = document.getElementById('brightPromptEmailConfirmInput');
    const whatsappInput = document.getElementById('regWhatsapp');
    const whatsappConfirmInput = document.getElementById('regWhatsappConfirm');
    const errorDiv = document.getElementById('brightPromptError');
    const okBtn = document.getElementById('brightPromptOkBtn');
    const backBtn = document.getElementById('brightPromptBackBtn');

    const homeNameInput = document.getElementById('studentName');
    if (nameInput && homeNameInput && homeNameInput.value.trim()) {
        nameInput.value = homeNameInput.value.trim().toUpperCase();
    }
    if (nameInput) nameInput.focus();

    const showError = (msg) => {
        if (errorDiv) {
            errorDiv.textContent = msg;
            errorDiv.style.display = 'block';
        }
    };

    if (backBtn) {
        backBtn.onclick = () => {
            overlay.remove();
            if (typeof window.openSubscriberTypeModal === 'function') {
                window.openSubscriberTypeModal('online');
            } else {
                unlockFullAccess();
            }
        };
    }

    if (okBtn) {
        okBtn.onclick = () => {
            const studentName = nameInput.value.trim().toUpperCase();
            const email = emailInput.value.trim();
            const emailConfirm = emailConfirmInput.value.trim();
            const whatsapp = whatsappInput.value.trim();
            const whatsappConfirm = whatsappConfirmInput.value.trim();

            if (!studentName || !email || !emailConfirm || !whatsapp || !whatsappConfirm) {
                showError("Please fill in all student name, email, and WhatsApp fields.");
                return;
            }

            if (email !== emailConfirm) {
                showError("Email addresses do not match. Please re-enter.");
                return;
            }

            if (whatsapp !== whatsappConfirm) {
                showError("WhatsApp numbers do not match. Please re-enter.");
                return;
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                showError("Please enter a valid email address format.");
                return;
            }

            const phoneRegex = /^\+[1-9]\d{7,14}$/;
            if (!phoneRegex.test(whatsapp)) {
                showError("Invalid phone number format. Must start with '+' followed by country code (e.g. +233241234567).");
                return;
            }

            overlay.remove();
            
            let checkingOverlay = document.createElement('div');
            checkingOverlay.id = 'arenaCheckingOverlay';
            checkingOverlay.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                background: rgba(5, 5, 5, 0.94); z-index: 999999;
                display: flex; flex-direction: column; justify-content: center; align-items: center;
                backdrop-filter: blur(10px); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                text-align: center; padding: 20px;
            `;
            checkingOverlay.innerHTML = `
                <div style="
                    width: 80px; height: 80px; border-radius: 50%;
                    border: 6px solid #1a1a1a;
                    border-top: 6px solid #00e5ff;
                    border-right: 6px solid #ffe600;
                    border-bottom: 6px solid #ff4081;
                    animation: spin 0.8s linear infinite;
                    box-shadow: 0 0 35px rgba(0, 229, 255, 0.5);
                    margin-bottom: 25px;
                "></div>
                <h2 style="color: #00e5ff; text-transform: uppercase; font-size: 22px; letter-spacing: 2px; margin-bottom: 10px; text-shadow: 0 0 10px rgba(255,230,0,0.4);">Validating Registration Details...</h2>
                <p style="color: #ffe600; font-size: 15px; font-family: monospace; letter-spacing: 1px; margin-bottom: 5px;">Preparing secure Paystack gateway handshake</p>
                <p style="color: #888; font-size: 12px; font-style: italic;">Please hold on...</p>
            `;
            document.body.appendChild(checkingOverlay);

            setTimeout(() => {
                checkingOverlay.remove();
                initializeSubscriptionPayment(email, planType, amountInPesewas, planName, currency, studentName, whatsapp);
            }, 1200);
        };
    }
}

async function selectPlanOption(planType, amountInPesewas, planName, currency = 'GHS') {
    // If user is operating in Existing Subscriber Top-Up mode
    if (window.isTopupMode && window.selectedTopupStudent) {
        initializeTopupPayment(planType, amountInPesewas, planName, currency);
    } else {
        // Standard New Subscriber registration flow
        showSubscriptionModalFlow(planType, amountInPesewas, planName, currency);
    }
}

window.selectPlanOption = selectPlanOption;

function initializeTopupPayment(planType, amountInPesewas, planName, currency = 'GHS') {
    const student = window.selectedTopupStudent;
    if (!student) {
        showColorfulAlert("Please select a student account first.", "Selection Required");
        return;
    }

    const studentName = (student.name || student.studentName || 'Student').toUpperCase();
    const studentEmail = student.email || `${studentName.toLowerCase().replace(/[^a-z0-9]/g, '')}@elormacademy.com`;
    const studentPhone = student.parentWhatsapp || student.whatsapp || window.searchedPhone || '+233000000000';

    if (typeof PaystackPop === 'undefined') {
        showCustomPopup("Gateway Error", "Payment gateway error: Paystack SDK missing. Please ensure internet connectivity.", "error");
        return;
    }

    let handler = PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: studentEmail,
        amount: amountInPesewas,
        currency: currency,
        ref: 'ELORM_TOPUP_' + Math.floor((Math.random() * 1000000000) + 1),
        channels: ['mobile_money', 'card'],
        metadata: {
            custom_fields: [
                { display_name: "Student Name", variable_name: "student_name", value: studentName },
                { display_name: "Operation", variable_name: "operation", value: "TOPUP" },
                { display_name: "Plan Type", variable_name: "plan_type", value: planType },
                { display_name: "Contact Number", variable_name: "phone_number", value: studentPhone },
                { display_name: "Student ID", variable_name: "student_id", value: student.id || student._id || '' }
            ]
        },
        callback: async function(response) {
            let loadingEl = document.createElement('div');
            loadingEl.id = 'paystackVerifyOverlay';
            loadingEl.style.cssText = 'display:flex; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(5,5,5,0.92); z-index:99999; justify-content:center; align-items:center; flex-direction:column; backdrop-filter: blur(6px);';
            loadingEl.innerHTML = `
                <div style="border: 5px solid #1a1a1a; border-top: 5px solid #00e5ff; border-right: 5px solid #ff4081; border-bottom: 5px solid #ffe600; border-radius: 50%; width: 70px; height: 70px; animation: spin 0.9s linear infinite;"></div>
                <h3 style="color: #00ff00; margin-top: 25px; font-family: monospace; font-size: 17px; letter-spacing: 1px;">Verifying payment & extending account...</h3>
            `;
            document.body.appendChild(loadingEl);

            try {
                const verifyRes = await fetch(`${API_BASE_URL}/api/paystack/verify-topup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        reference: response.reference,
                        studentId: student.id || student._id || '',
                        studentName: studentName,
                        email: studentEmail,
                        phone: studentPhone,
                        plan: planType,
                        amount: amountInPesewas
                    })
                });

                const verifyResult = await verifyRes.json();
                loadingEl.remove();

                if (verifyRes.ok && verifyResult.success) {
                    const newExpStr = verifyResult.newExpiryDate || verifyResult.expDate;
                    let formattedNewExp = 'Active';
                    if (newExpStr) {
                        const d = new Date(newExpStr);
                        if (!isNaN(d.getTime())) {
                            formattedNewExp = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
                        }
                    }

                    const currentLocalName = localStorage.getItem('studentName');
                    if (currentLocalName && currentLocalName.trim().toUpperCase() === studentName) {
                        if (newExpStr) localStorage.setItem('mrelorm_expiry', new Date(newExpStr).getTime());
                        localStorage.setItem('mrelorm_subscriber', 'true');
                    }

                    if (typeof window.closeAllModals === 'function') {
                        window.closeAllModals();
                    }

                    showColorfulAlert(
                        `Payment Confirmed!\n\n` +
                        `Subscription for ${studentName} has been successfully extended with ${planName}.\n\n` +
                        `📅 New Expiration Date: ${formattedNewExp}\n` +
                        `💳 Reference: ${response.reference}`,
                        "Top-Up Successful",
                        () => { window.location.reload(); }
                    );
                } else {
                    showColorfulAlert(
                        (verifyResult && verifyResult.message) ? verifyResult.message : "Payment received but account extension failed. Please contact support with reference: " + response.reference,
                        "Verification Notice"
                    );
                }
            } catch (verErr) {
                loadingEl.remove();
                showColorfulAlert(`Verification network error: ${verErr.message}. Transaction Reference: ${response.reference}`, "Network Error");
            }
        },
        onClose: function() {
            showColorfulAlert("Payment window closed. Your account top-up was not completed.", "Payment Cancelled");
        }
    });

    handler.openIframe();
}

async function checkTopicAccess(topicIndex) {
    if (topicIndex <= 3) {
        return true; 
    }

    const storedProductCode = localStorage.getItem('mrelorm_product_code') || localStorage.getItem('mrelorm_plan');
    const storedSchoolCode = localStorage.getItem('schoolCode') || 'ONLINE-DIRECT';
    if (storedProductCode) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/check-subscription`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productCode: storedProductCode, schoolCode: storedSchoolCode })
            });
            const data = await response.json();
            if (data.status === 'active_subscription') {
                return true;
            }
        } catch (err) {
            console.error('Topic access check error:', err);
        }
    }

    if (typeof unlockFullAccess === 'function') {
        unlockFullAccess();
    } else {
        selectPlanOption('6months', 25000, '6-Month Pass (GHS 250)', 'GHS');
    }
    return false;
}

function showPaymentSuccessModal(reference, email, whatsapp, studentName, planType, planName, currency) {
    let existing = document.getElementById('brightSuccessModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'brightSuccessModal';
    overlay.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(5, 5, 5, 0.85);
        backdrop-filter: blur(8px);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
        font-family: inherit;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
        background: #0a0a0a;
        border: 2px solid #00ff00;
        box-shadow: 0 0 30px rgba(0, 255, 0, 0.4);
        border-radius: 16px;
        padding: 30px;
        width: 90%;
        max-width: 420px;
        text-align: center;
        animation: modalPop 0.3s ease-out;
    `;

    card.innerHTML = `
        <div style="font-size: 3rem; margin-bottom: 10px;">🎉</div>
        <h3 style="color: #00ff00; margin-top: 0; font-size: 1.4rem; letter-spacing: 1px; text-transform: uppercase;">Payment Successful!</h3>
        <p style="color: #ffffff; font-size: 0.95rem; line-height: 1.6; margin-bottom: 15px;">
            Full learning arena access is ready to verify!
        </p>
        <div style="background: #121212; border: 1px dashed #00e5ff; padding: 10px; border-radius: 8px; margin-bottom: 20px;">
            <small style="color: #00e5ff; display: block; font-family: monospace;">REFERENCE ID:</small>
            <span style="color: #ffe600; font-family: monospace; font-weight: bold; font-size: 1rem;">${escapeHtml(reference)}</span>
        </div>
        <button id="successContinueBtn" style="
            width: 100%; padding: 12px; background: linear-gradient(135deg, #00ff00, #00e5ff); color: #050505; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; font-size: 13px;
        ">CONTINUE</button>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    document.getElementById('successContinueBtn').onclick = () => {
        overlay.remove();
        showVerificationModal({
            reference: reference,
            email: email,
            whatsapp: whatsapp,
            studentName: studentName.toUpperCase(),
            planType: planType,
            planName: planName,
            currency: currency
        });
    };
}

function initializeSubscriptionPayment(userEmail, planType, amountInPesewas, selectedPlanName, currency = 'GHS', studentName = '', whatsapp = '') {
    if (typeof PaystackPop === 'undefined') {
        showCustomPopup("Gateway Error", "Payment gateway error: Paystack SDK missing in HTML. Please ensure <script src=\"https://js.paystack.co/v1/inline.js\"></script> is included in this page header.", "error");
        return;
    }

    let handler = PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: userEmail,
        amount: amountInPesewas,
        currency: currency,
        ref: 'ELORM_' + Math.floor((Math.random() * 1000000000) + 1),
        channels: ['mobile_money', 'card'],
        metadata: {
            custom_fields: [
                {
                    display_name: "Selected Plan",
                    variable_name: "selected_plan",
                    value: selectedPlanName
                },
                {
                    display_name: "Student Name",
                    variable_name: "student_name",
                    value: studentName.toUpperCase()
                },
                {
                    display_name: "Contact Number",
                    variable_name: "contact_number",
                    value: whatsapp
                }
            ]
        },
        callback: function(response) {
            showPaymentSuccessModal(response.reference, userEmail, whatsapp, studentName.toUpperCase(), planType, selectedPlanName, currency);
        },
        onClose: function() {
            showCustomPopup("Payment Cancelled", "Payment was not completed. Online registration and access remain locked.", "error");
            console.log('Payment window closed or cancelled.');
        }
    });

    handler.openIframe();
}

// Ensure event listener for the delete completion button correctly handles removal and page reload
document.addEventListener('click', function(e) {
    if (e.target && e.target.id === 'deleteCompleteOkBtn') {
        const overlay = document.getElementById('brightDeleteOverlay');
        if (overlay) overlay.remove();
        window.location.reload();
    }
});