const { Schema, model } = require('mongoose');

const ChangeSchema = new Schema({
    risk: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true },
    type: { type: String, required: true }, // fund | stock
    payload: Schema.Types.Mixed,
}, { timestamps: false });

module.exports = model('Change', ChangeSchema);
