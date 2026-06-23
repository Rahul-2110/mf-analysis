const { generateAllRisks } = require('./index');
const { closeDatabase } = require('./db');

(async () => {
    try {
        await generateAllRisks();
        await closeDatabase();
        process.exit(0);
    } catch (error) {
        console.error('Generator failed:', error);
        await closeDatabase();
        process.exit(1);
    }
})();
