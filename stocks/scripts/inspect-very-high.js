const { connectToDatabase, closeDatabase, mongoose } = require('../db');
const StockSummary = require('../models/StockSummary');
const FundSnapshot = require('../models/FundSnapshot');

const inspect = async () => {
    await connectToDatabase();
    const risk = 'Very-High';
    const summaries = await StockSummary.find({ risk, type: 'detail' }).lean();
    console.log(`Found ${summaries.length} detail summaries for ${risk}`);

    for (const s of summaries) {
        console.log(`--- ${s.risk} ${s.date} ---`);
        // Find top items by fundCount
        const top = (s.items || []).slice().sort((a, b) => b.fundCount - a.fundCount).slice(0, 10);
        for (const item of top) {
            const funds = item.funds || [];
            const totalListed = funds.length;
            const uniqueIds = new Set(funds.map((f) => String(f.searchId)));
            const uniqueCount = uniqueIds.size;
            const dup = totalListed - uniqueCount;
            console.log(`${item.name} — fundCount:${item.fundCount} listed:${totalListed} unique:${uniqueCount} dup:${dup}`);
            if (dup > 0) {
                // show first duplicate ids
                const counts = {};
                for (const f of funds) counts[String(f.searchId)] = (counts[String(f.searchId)] || 0) + 1;
                const dups = Object.entries(counts).filter(([, c]) => c > 1).slice(0,5);
                console.log(' duplicate ids sample:', dups);
            }
        }
    }

    // Also inspect snapshots
    const snaps = await FundSnapshot.find({ risk }).lean();
    console.log(`Found ${snaps.length} snapshots for ${risk}`);
    for (const snap of snaps) {
        try {
            let payload = snap.payload;
            if (!payload && snap.gridFsId) {
                // don't attempt GridFS read here, just report presence
                console.log(`Snapshot ${snap._id} uses GridFS id ${snap.gridFsId}`);
                continue;
            }
            const funds = payload?.funds || [];
            const total = funds.length;
            const unique = new Set(funds.map((f) => String(f.searchId))).size;
            console.log(`Snapshot ${snap.date} listed funds ${total} unique ${unique}`);
        } catch (err) {
            console.error('Error reading snap', snap._id, err.message);
        }
    }

    await closeDatabase();
};

if (require.main === module) inspect();
