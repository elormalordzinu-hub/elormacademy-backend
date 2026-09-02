// 1. Search Functionality
function searchGames() {
    const query = document.getElementById('gameSearch').value.toLowerCase();
    const cards = document.querySelectorAll('.lab-card');
    
    cards.forEach(card => {
        const title = card.querySelector('h3').innerText.toLowerCase();
        // Show/Hide based on search query
        card.style.display = title.includes(query) ? 'block' : 'none';
    });
}

// 2. Filter Functionality with Refinement Metadata
async function filterGames() {
    // Capture user inputs
    const subject = document.getElementById('subject').value;
    const grade = document.getElementById('grade').value;
    const curriculum = document.getElementById('curriculum').value; 
    const stage = document.getElementById('labStage');

    // Show loading state
    stage.innerHTML = '<div class="spinner"></div>';

    try {
        // Fetch data including curriculum
        const labs = await DataService.getLabData(subject, grade, curriculum);
        
        // Reset the Stage
        stage.innerHTML = `<h1 style="text-align: center;">Lab Stage</h1>`;

        // Loop through data and create cards
        if (labs && labs.length > 0) {
            labs.forEach((lab) => {
                const card = document.createElement('div');
                card.className = 'lab-card';
                card.innerHTML = `
                    <h3>${lab.title}</h3>
                    <p style="color: #4dd0e1; font-size: 0.8rem; margin-top: 5px;">
                        Subject: ${lab.subject ? lab.subject.toUpperCase() : 'N/A'} | 
                        Grade: ${lab.grade || 'N/A'} | 
                        Curriculum: ${lab.curriculum ? lab.curriculum.toUpperCase() : 'N/A'}
                    </p>
                `;
                stage.appendChild(card);
            });
        } else {
            stage.innerHTML += `<p style="text-align: center;">No labs found for these criteria.</p>`;
        }

    } catch (e) {
        console.error("Simulation load error:", e);
        stage.innerHTML = `<p style="text-align: center; color: #ff4081;">Error: Could not connect to the Lab Database.</p>`;
    }
}