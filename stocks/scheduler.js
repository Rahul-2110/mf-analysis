const cron = require('node-cron');
const { generateAllRisks } = require('./index');
const { closeDatabase } = require('./db');

const scheduleExpression = process.env.GENERATE_CRON || '0 1 * * *'; // daily at 1:00 AM

const runTask = async () => {
    console.log('Scheduled generator started');
    try {
        await generateAllRisks();
        console.log('Scheduled generator completed');
    } catch (error) {
        console.error('Scheduled generator failed:', error);
    } finally {
        await closeDatabase();
    }
};

cron.schedule(scheduleExpression, runTask, {
    scheduled: true,
    timezone: process.env.TIMEZONE || 'UTC',
});

console.log(`Scheduler running. Next run: ${scheduleExpression}`);
runTask();
