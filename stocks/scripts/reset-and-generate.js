const { connectToDatabase, mongoose, closeDatabase } = require('../db');

const collections = [
    'fund_snapshots',
    'stock_summaries',
    'changes',
    'run_logs',
    'search_results',
    'mutual_funds',
];

const run = async () => {
    try {
        console.log('Connecting to DB...');
        await connectToDatabase();
        const db = mongoose.connection.db;
        const ts = Date.now();

        // Backup and clear collections
        for (const name of collections) {
            const coll = db.collection(name);
            const docs = await coll.find().toArray();
            if (docs.length) {
                const backupName = `${name}_backup_${ts}`;
                await db.collection(backupName).insertMany(docs);
                await coll.deleteMany({});
                console.log(`Backed up ${docs.length} docs from ${name} -> ${backupName} and cleared original`);
            } else {
                console.log(`No documents in ${name}`);
            }
        }

        // Backup and clear GridFS bucket 'snapshot_files'
        const bucketName = 'snapshot_files';
        const filesColl = db.collection(`${bucketName}.files`);
        const chunksColl = db.collection(`${bucketName}.chunks`);
        const files = await filesColl.find().toArray();
        if (files.length) {
            const filesBackup = `${bucketName}.files_backup_${ts}`;
            const chunksBackup = `${bucketName}.chunks_backup_${ts}`;
            const chunks = await chunksColl.find().toArray();
            await db.collection(filesBackup).insertMany(files);
            await db.collection(chunksBackup).insertMany(chunks);
            await filesColl.deleteMany({});
            await chunksColl.deleteMany({});
            console.log(`Backed up and cleared GridFS bucket '${bucketName}' (${files.length} files, ${chunks.length} chunks)`);
        } else {
            console.log('No GridFS snapshot files to clear');
        }

        // Run full generator
        console.log('Starting full generator (this may take a while)...');
        const { generateAllRisks } = require('../index');
        await generateAllRisks();
        console.log('Generator finished');

    } catch (err) {
        console.error('Reset and generate failed:', err);
    } finally {
        await closeDatabase();
        console.log('Done');
    }
};

if (require.main === module) run();

module.exports = { run };
