const { Schema, model } = require('mongoose');

const MutualFundSchema = new Schema({
    risk: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true },
    type: { type: String, default: 'filtered' },
    payload: [Schema.Types.Mixed],
}, { timestamps: false });

module.exports = model('MutualFund', MutualFundSchema);
