const { Schema, model } = require('mongoose');

const FundSnapshotSchema = new Schema({
    risk: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true },
    type: { type: String, default: 'snapshot' },
    payload: Schema.Types.Mixed,
    // For large snapshots that don't fit BSON, store in GridFS and keep a reference
    gridFsId: { type: Schema.Types.ObjectId, index: true },
    fileName: String,
    fileSize: Number,
}, { timestamps: false, strict: false });

module.exports = model('FundSnapshot', FundSnapshotSchema);
