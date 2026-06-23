const { Schema, model } = require('mongoose');

const RunLogSchema = new Schema({
    risk: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true },
    type: { type: String },
    startedAt: Date,
    completedAt: Date,
    comparisonStatus: String,
    comparisonReason: String,
    errors: [Schema.Types.Mixed],
    totalFound: Number,
    totalFiltered: Number,
    holdingsFetched: Number,
    holdingsFailed: Number,
    comparison: Schema.Types.Mixed,
    durationMs: Number,
}, { timestamps: false, strict: false });

module.exports = model('RunLog', RunLogSchema);
