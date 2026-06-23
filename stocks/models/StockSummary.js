const { Schema, model } = require('mongoose');

const StockSummarySchema = new Schema({
    risk: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true },
    type: { type: String, required: true }, // coverage | weight | detail
    items: [Schema.Types.Mixed],
}, { timestamps: false });

module.exports = model('StockSummary', StockSummarySchema);
