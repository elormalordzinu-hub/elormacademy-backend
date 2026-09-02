const DataService = {
    async getLabData(subject, grade, curriculum) {
        try {
            // This path assumes your files are at the same level as the /data folder
            const response = await fetch('data/simulations.json');
            const data = await response.json();
            
            // Filter logic
            return data.filter(lab => 
                (subject === "" || lab.subject === subject) &&
                (grade === "" || lab.grade === grade) &&
                (curriculum === "" || lab.curriculum === curriculum)
            );
        } catch (error) {
            console.error("Data fetch failed:", error);
            return [];
        }
    }
};