const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { GridFSBucket } = require('mongodb');
const { connectToDatabase, closeDatabase } = require('./db');
const FundSnapshot = require('./models/FundSnapshot');

const run = async () => {
    await connectToDatabase();
    const db = mongoose.connection.db;
    const bucket = new GridFSBucket(db, { bucketName: 'snapshot_files' });

    const cursor = FundSnapshot.find({ payload: { $exists: true, $ne: null } }).cursor();
    let count = 0;

    for await (const doc of cursor) {
        try {
            const payload = doc.payload;
            const jsonStr = JSON.stringify(payload);
            const buffer = Buffer.from(jsonStr, 'utf8');

            // Upload buffer to GridFS by streaming from a temp file
            const tmpName = path.join(__dirname, `.tmp_snapshot_${doc._id}.json`);
            await fs.promises.writeFile(tmpName, buffer);

            const uploadId = await new Promise((resolve, reject) => {
                const uploadStream = bucket.openUploadStream(tmpName.split(path.sep).pop());
                fs.createReadStream(tmpName)
                    .pipe(uploadStream)
                    .on('error', (err) => reject(err))
                    .on('finish', (file) => resolve(file._id));
            });

            const stats = await fs.promises.stat(tmpName);

            // Update document: set gridFsId, fileName, fileSize, unset payload
            await FundSnapshot.findByIdAndUpdate(doc._id, {
                $set: {
                    gridFsId: uploadId,
                    fileName: `${doc.risk || 'snapshot'}-${doc.date || 'unknown'}.json`,
                    fileSize: stats.size,
                },
                $unset: { payload: '' },
            });

            await fs.promises.unlink(tmpName);
            count += 1;
            console.log(`Migrated snapshot ${doc._id} -> GridFS id ${uploadId}`);
        } catch (err) {
            console.error(`Failed to migrate snapshot ${doc._id}:`, err);
        }
    }

    console.log(`Migration completed. ${count} snapshots migrated.`);
    await closeDatabase();
};

run().catch(async (err) => {
    console.error('Migration script failed:', err);
    try { await closeDatabase(); } catch (e) {}
    process.exit(1);
});
