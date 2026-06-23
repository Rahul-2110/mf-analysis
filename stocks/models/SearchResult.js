const { Schema, model } = require('mongoose');

const SearchResultSchema = new Schema({
    risk: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true },
    type: { type: String, default: 'search' },
    payload: Schema.Types.Mixed,
}, { timestamps: false });

module.exports = model('SearchResult', SearchResultSchema);
