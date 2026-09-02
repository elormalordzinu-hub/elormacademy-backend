
// This script handles the routing between your main subjects, the grade selection, and the final activity menu
const LearningArena = {
    state: {
        subject: null,
        grade: null,
        activity: null
    },

    init: function() {
        console.log("Learning Arena Router Initialized.");
    },

    // Triggered when a student clicks a subject on index.html
    selectSubject: function(subject) {
        this.state.subject = subject;
        console.log(`Subject selected: ${subject}`);
        window.location.href = '/templates/subject-selector.html?subject=' + subject;
    },

    // Triggered on subject-selector.html
    selectGrade: function(grade) {
        this.state.grade = grade;
        console.log(`Grade selected: ${grade}`);
        window.location.href = '/templates/activity-menu.html';
    },

    // Triggered on activity-menu.html
    selectActivity: function(activity) {
        this.state.activity = activity;
        console.log(`Activity selected: ${activity}`);
        // Redirect to the quiz page to load the specific JSON
        window.location.href = '/templates/quiz-page.html?sub=' + this.state.subject + '&gr=' + this.state.grade + '&type=' + activity;
    }
};

// Initialize on load
LearningArena.init();

//This script handles the routing between your main subjects, the grade selection, and the final activity menu