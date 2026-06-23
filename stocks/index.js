const { default: axios } = require('axios');

const PAGE_SIZE = 20;
const WEIGHT_CHANGE_THRESHOLD = 0.05;

const riskFolder = (risk) => risk.replace(/ /g, '-');

const formatDate = (date) => {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
};

const yesterdayDate = () => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return formatDate(date);
};

const formattedDate = formatDate(new Date());

const { connectToDatabase, mongoose } = require('./db');
const RunLog = require('./models/RunLog');
const StockSummary = require('./models/StockSummary');
const FundSnapshot = require('./models/FundSnapshot');
const Change = require('./models/Change');
const SearchResult = require('./models/SearchResult');
const MutualFund = require('./models/MutualFund');
const { Readable } = require('stream');

const persistSearchResults = async (risk, date, payload) => {
    await SearchResult.findOneAndUpdate(
        { risk: riskFolder(risk), date },
        { risk: riskFolder(risk), date, payload },
        { upsert: true, new: true }
    );
};

const persistFilteredFunds = async (risk, date, payload) => {
    await MutualFund.findOneAndUpdate(
        { risk: riskFolder(risk), date },
        { risk: riskFolder(risk), date, payload },
        { upsert: true, new: true }
    );
};

const persistSnapshot = async (risk, date, payload) => {
    // Try to store payload inline; if BSON size error occurs, fallback to GridFS.
    try {
        await FundSnapshot.findOneAndUpdate(
            { risk: riskFolder(risk), date, type: 'snapshot' },
            { risk: riskFolder(risk), date, type: 'snapshot', payload, gridFsId: null, fileName: null, fileSize: null },
            { upsert: true, new: true }
        );
    } catch (err) {
        const isBsonError = err && (err.code === 'ERR_OUT_OF_RANGE' || /BSON/.test(err.message) || /serializeInto/.test(err.stack));
        if (!isBsonError) throw err;

        // Ensure DB connection
        if (!mongoose?.connection?.db) throw err;

        const bucketName = process.env.SNAPSHOT_BUCKET || 'snapshot_files';
        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName });
        const filename = `snapshot-${riskFolder(risk)}-${date}.json`;
        const stream = Readable.from([JSON.stringify(payload)]);

        const uploadStream = bucket.openUploadStream(filename, { metadata: { risk: riskFolder(risk), date } });
        await new Promise((resolve, reject) => {
            stream.pipe(uploadStream).on('error', reject).on('finish', resolve);
        });

        const fileId = uploadStream.id;
        // read file doc to get size
        const filesColl = mongoose.connection.db.collection(`${bucketName}.files`);
        const fileDoc = await filesColl.findOne({ _id: fileId });
        const size = fileDoc?.length ?? fileDoc?.size ?? 0;

        await FundSnapshot.findOneAndUpdate(
            { risk: riskFolder(risk), date, type: 'snapshot' },
            { risk: riskFolder(risk), date, type: 'snapshot', payload: null, gridFsId: fileId, fileName: filename, fileSize: size },
            { upsert: true, new: true }
        );
    }
};

const persistStockSummary = async (risk, date, type, items) => {
    await StockSummary.findOneAndUpdate(
        { risk: riskFolder(risk), date, type },
        { risk: riskFolder(risk), date, type, items },
        { upsert: true, new: true }
    );
};

const persistChanges = async (risk, date, type, payload) => {
    await Change.findOneAndUpdate(
        { risk: riskFolder(risk), date, type },
        { risk: riskFolder(risk), date, type, payload },
        { upsert: true, new: true }
    );
};

const persistRunLog = async (risk, date, payload) => {
    await RunLog.findOneAndUpdate(
        { risk: riskFolder(risk), date },
        { risk: riskFolder(risk), date, ...payload },
        { upsert: true, new: true }
    );
};

const getSavedSnapshot = async (risk, date) => {
    return FundSnapshot.findOne({ risk: riskFolder(risk), date, type: 'snapshot' }).lean();
};

const getSavedCoverageSummary = async (risk, date) => {
    return StockSummary.findOne({ risk: riskFolder(risk), date, type: 'coverage' }).lean();
};

const log = (risk, message) => {
    console.log(`[${riskFolder(risk)}] ${message}`);
};

const getMutualFundsListPage = async (risk, page) => {
    const data = await axios.get('https://groww.in/v1/api/search/v1/derived/scheme', {
        params: {
            plan_type: 'Direct',
            q: '',
            risk,
            available_for_investment: true,
            doc_type: 'scheme',
            page_no: page,
            size: PAGE_SIZE,
        },
    });
    return data.data.content;
};

const getMutualFundsList = async (risk) => {
    try {
        const data = await axios.get('https://groww.in/v1/api/search/v1/derived/scheme', {
            params: {
                plan_type: 'Direct',
                q: '',
                risk,
                available_for_investment: true,
                doc_type: 'scheme',
                page_no: 1,
                size: PAGE_SIZE,
            },
        });

        const totalPages = Math.ceil(data.data.total_results / PAGE_SIZE);

        if (totalPages > 1) {
            const pagePromises = [];
            for (let i = 2; i <= totalPages; i++) {
                pagePromises.push(getMutualFundsListPage(risk, i));
            }
            const pages = await Promise.all(pagePromises);
            pages.forEach((page) => {
                data.data.content.push(...page);
            });
        }

        return data.data;
    } catch (error) {
        console.log(error.message);
        return { content: [], total_results: 0 };
    }
};

const getFundData = async (fundSearchId, retries = 1) => {
    try {
        const data = await axios.get(
            `https://groww.in/v1/api/data/mf/web/v4/scheme/search/${fundSearchId}`
        );
        return { holdings: data.data.holdings ?? [], error: null };
    } catch (error) {
        if (retries > 0) {
            return getFundData(fundSearchId, retries - 1);
        }
        return { holdings: [], error: error.message };
    }
};

const stockKey = (holding) => holding.stock_search_id || holding.company_name;

const buildFundSnapshots = (filteredFundsList, holdingsResults) => {
    return filteredFundsList.map((fund, i) => {
        const result = holdingsResults[i];
        const holdings = result?.holdings ?? [];
        return {
            searchId: fund.search_id,
            fundName: fund.fund_name,
            schemeCode: fund.scheme_code,
            subCategory: fund.sub_category,
            return1y: fund.return1y,
            holdings,
            equityHoldings: holdings.filter((h) => h.nature_name === 'EQUITY'),
            fetchError: result?.error ?? null,
        };
    });
};

const buildStockSummary = (fundSnapshots) => {
    const totalFunds = fundSnapshots.length;
    const stocksMap = {};

    // For each fund, aggregate holdings by stock key so a fund only counts once per stock.
    fundSnapshots.forEach((fund) => {
        const perFundMap = new Map();
        (fund.equityHoldings || []).forEach((holding) => {
            const key = stockKey(holding);
            const weight = holding.corpus_per ?? 0;
            if (!perFundMap.has(key)) {
                perFundMap.set(key, {
                    name: holding.company_name,
                    stockSearchId: holding.stock_search_id || null,
                    sector: holding.sector_name || null,
                    weight: weight,
                });
            } else {
                // If multiple holding rows for same stock in a fund, sum weights
                const existing = perFundMap.get(key);
                existing.weight += weight;
                perFundMap.set(key, existing);
            }
        });

        perFundMap.forEach((holding, key) => {
            if (!stocksMap[key]) {
                stocksMap[key] = {
                    name: holding.name,
                    stockSearchId: holding.stockSearchId,
                    sector: holding.sector,
                    fundCount: 0,
                    totalWeight: 0,
                    maxWeight: -Infinity,
                    minWeight: Infinity,
                    funds: [],
                };
            }
            const entry = stocksMap[key];
            const weight = holding.weight;
            entry.fundCount += 1;
            entry.totalWeight += weight;
            entry.maxWeight = Math.max(entry.maxWeight, weight);
            entry.minWeight = Math.min(entry.minWeight, weight);
            entry.funds.push({
                searchId: fund.searchId,
                fundName: fund.fundName,
                weight,
            });
        });
    });

    return Object.values(stocksMap).map((entry) => ({
        name: entry.name,
        stockSearchId: entry.stockSearchId,
        sector: entry.sector,
        fundCount: entry.fundCount,
        totalFunds,
        coveragePercent: totalFunds > 0 ? Number(((entry.fundCount / totalFunds) * 100).toFixed(2)) : 0,
        avgWeight: entry.fundCount > 0 ? Number((entry.totalWeight / entry.fundCount).toFixed(4)) : 0,
        totalWeight: Number(entry.totalWeight.toFixed(4)),
        maxWeight: entry.maxWeight === -Infinity ? 0 : Number(entry.maxWeight.toFixed(4)),
        minWeight: entry.minWeight === Infinity ? 0 : Number(entry.minWeight.toFixed(4)),
        funds: entry.funds,
    }));
};

const equityWeightMap = (equityHoldings) => {
    const map = new Map();
    equityHoldings.forEach((h) => {
        map.set(stockKey(h), {
            name: h.company_name,
            weight: h.corpus_per ?? 0,
        });
    });
    return map;
};

const compareFundSnapshots = (todaySnapshots, yesterdaySnapshots) => {
    const yesterdayById = new Map(yesterdaySnapshots.map((f) => [f.searchId, f]));
    const todayById = new Map(todaySnapshots.map((f) => [f.searchId, f]));

    const newFunds = todaySnapshots
        .filter((f) => !yesterdayById.has(f.searchId))
        .map((f) => ({ searchId: f.searchId, fundName: f.fundName }));

    const droppedFunds = yesterdaySnapshots
        .filter((f) => !todayById.has(f.searchId))
        .map((f) => ({ searchId: f.searchId, fundName: f.fundName }));

    const fundChanges = [];

    todaySnapshots.forEach((todayFund) => {
        const yesterdayFund = yesterdayById.get(todayFund.searchId);
        if (!yesterdayFund) return;

        const todayMap = equityWeightMap(todayFund.equityHoldings);
        const yesterdayMap = equityWeightMap(yesterdayFund.equityHoldings);

        const added = [];
        const removed = [];
        const weightChanged = [];

        todayMap.forEach((todayStock, key) => {
            if (!yesterdayMap.has(key)) {
                added.push({ name: todayStock.name, weight: todayStock.weight });
            }
        });

        yesterdayMap.forEach((yesterdayStock, key) => {
            if (!todayMap.has(key)) {
                removed.push({ name: yesterdayStock.name, weight: yesterdayStock.weight });
            }
        });

        todayMap.forEach((todayStock, key) => {
            const yesterdayStock = yesterdayMap.get(key);
            if (!yesterdayStock) return;
            const delta = todayStock.weight - yesterdayStock.weight;
            if (Math.abs(delta) >= WEIGHT_CHANGE_THRESHOLD) {
                weightChanged.push({
                    name: todayStock.name,
                    previousWeight: yesterdayStock.weight,
                    currentWeight: todayStock.weight,
                    delta: Number(delta.toFixed(4)),
                });
            }
        });

        if (added.length || removed.length || weightChanged.length) {
            fundChanges.push({
                searchId: todayFund.searchId,
                fundName: todayFund.fundName,
                added,
                removed,
                weightChanged,
            });
        }
    });

    return { newFunds, droppedFunds, fundChanges };
};

const compareStockSummaries = (todaySummary, yesterdaySummary) => {
    const yesterdayByKey = new Map();
    yesterdaySummary.forEach((s) => {
        yesterdayByKey.set(s.stockSearchId || s.name, s);
    });

    const increasedCoverage = [];
    const decreasedCoverage = [];
    const increasedAvgWeight = [];
    const decreasedAvgWeight = [];
    const newStocks = [];
    const removedStocks = [];

    todaySummary.forEach((todayStock) => {
        const key = todayStock.stockSearchId || todayStock.name;
        const yesterdayStock = yesterdayByKey.get(key);

        if (!yesterdayStock) {
            newStocks.push({
                name: todayStock.name,
                fundCount: todayStock.fundCount,
                avgWeight: todayStock.avgWeight,
            });
            return;
        }

        const fundCountDelta = todayStock.fundCount - yesterdayStock.fundCount;
        const avgWeightDelta = todayStock.avgWeight - yesterdayStock.avgWeight;

        if (fundCountDelta > 0) {
            increasedCoverage.push({
                name: todayStock.name,
                previousFundCount: yesterdayStock.fundCount,
                currentFundCount: todayStock.fundCount,
                delta: fundCountDelta,
            });
        } else if (fundCountDelta < 0) {
            decreasedCoverage.push({
                name: todayStock.name,
                previousFundCount: yesterdayStock.fundCount,
                currentFundCount: todayStock.fundCount,
                delta: fundCountDelta,
            });
        }

        if (avgWeightDelta >= WEIGHT_CHANGE_THRESHOLD) {
            increasedAvgWeight.push({
                name: todayStock.name,
                previousAvgWeight: yesterdayStock.avgWeight,
                currentAvgWeight: todayStock.avgWeight,
                delta: Number(avgWeightDelta.toFixed(4)),
            });
        } else if (avgWeightDelta <= -WEIGHT_CHANGE_THRESHOLD) {
            decreasedAvgWeight.push({
                name: todayStock.name,
                previousAvgWeight: yesterdayStock.avgWeight,
                currentAvgWeight: todayStock.avgWeight,
                delta: Number(avgWeightDelta.toFixed(4)),
            });
        }

        yesterdayByKey.delete(key);
    });

    yesterdayByKey.forEach((yesterdayStock) => {
        removedStocks.push({
            name: yesterdayStock.name,
            fundCount: yesterdayStock.fundCount,
            avgWeight: yesterdayStock.avgWeight,
        });
    });

    return {
        increasedCoverage,
        decreasedCoverage,
        increasedAvgWeight,
        decreasedAvgWeight,
        newStocks,
        removedStocks,
    };
};

const loadYesterdaySnapshot = async (risk) => {
    const yesterday = yesterdayDate();
    const record = await getSavedSnapshot(risk, yesterday);
    return record?.payload ?? null;
};

const generateData = async (risk, percentage) => {
    const startTime = Date.now();
    const folder = riskFolder(risk);
    const runLog = {
        risk,
        date: formattedDate,
        startedAt: new Date(startTime).toISOString(),
        comparisonStatus: 'skipped',
        errors: [],
    };

    await connectToDatabase();
    log(risk, 'Fetching funds...');
    const funds = await getMutualFundsList(risk);
    const totalFound = funds.content?.length ?? 0;

    await persistSearchResults(risk, formattedDate, funds);

    let filteredFundsList = (funds.content ?? []).filter((fund) => fund.return1y > percentage);

    // Deduplicate funds by search_id in case the API returns duplicates
    const uniqueMap = new Map();
    let dupCount = 0;
    for (const f of filteredFundsList) {
        if (!uniqueMap.has(f.search_id)) uniqueMap.set(f.search_id, f);
        else dupCount += 1;
    }
    if (dupCount > 0) {
        log(risk, `Removed ${dupCount} duplicate funds from filtered list`);
        filteredFundsList = Array.from(uniqueMap.values());
    }
    runLog.totalFound = totalFound;
    runLog.totalFiltered = filteredFundsList.length;

    log(risk, `${totalFound} found, ${filteredFundsList.length} pass filter`);

    await persistFilteredFunds(risk, formattedDate, filteredFundsList);

    if (filteredFundsList.length === 0) {
        runLog.durationMs = Date.now() - startTime;
        runLog.completedAt = new Date().toISOString();
        await persistRunLog(risk, formattedDate, runLog);
        log(risk, 'No funds after filter — done');
        return;
    }

    const holdingsPromises = filteredFundsList.map((fund) => getFundData(fund.search_id));
    const holdingsResults = await Promise.all(holdingsPromises);

    const fetchErrors = holdingsResults
        .map((result, i) => (result.error ? { searchId: filteredFundsList[i].search_id, error: result.error } : null))
        .filter(Boolean);

    const fetchOk = filteredFundsList.length - fetchErrors.length;
    runLog.holdingsFetched = fetchOk;
    runLog.holdingsFailed = fetchErrors.length;
    runLog.errors = fetchErrors;

    log(risk, `Holdings fetched: ${fetchOk} ok, ${fetchErrors.length} failed`);

    const fundSnapshots = buildFundSnapshots(filteredFundsList, holdingsResults);
    const snapshotPayload = {
        date: formattedDate,
        risk,
        totalFunds: fundSnapshots.length,
        funds: fundSnapshots,
    };

    await persistSnapshot(risk, formattedDate, snapshotPayload);
    log(risk, `Saved snapshot for ${formattedDate}`);

    const stockSummary = buildStockSummary(fundSnapshots);
    const byCoverage = [...stockSummary]
        .map(({ funds, ...rest }) => rest)
        .sort((a, b) => b.fundCount - a.fundCount);
    const byAvgWeight = [...stockSummary]
        .map(({ funds, ...rest }) => rest)
        .sort((a, b) => b.avgWeight - a.avgWeight);

    await persistStockSummary(risk, formattedDate, 'coverage', byCoverage);
    await persistStockSummary(risk, formattedDate, 'weight', byAvgWeight);
    await persistStockSummary(risk, formattedDate, 'detail', stockSummary);

    const top5 = byCoverage.slice(0, 5);
    if (top5.length) {
        const top5Str = top5
            .map((s) => `${s.name} (${s.fundCount} funds, ${s.avgWeight}% avg)`)
            .join(', ');
        log(risk, `Top 5 common equities: ${top5Str}`);
    }

    const yesterdaySnapshot = await loadYesterdaySnapshot(risk);
    if (!yesterdaySnapshot) {
        const yesterday = yesterdayDate();
        log(risk, `Comparison skipped — no snapshot for ${yesterday}`);
        runLog.comparisonStatus = 'skipped';
        runLog.comparisonReason = `No snapshot for ${yesterday}`;
    } else {
        const yesterdayFunds = yesterdaySnapshot.funds ?? yesterdaySnapshot;
        const fundDiff = compareFundSnapshots(fundSnapshots, yesterdayFunds);

        const yesterdaySummary = await getSavedCoverageSummary(risk, yesterdayDate());
        let stockChanges = null;

        if (yesterdaySummary?.items) {
            stockChanges = compareStockSummaries(stockSummary, yesterdaySummary.items);
        } else {
            stockChanges = compareStockSummaries(
                stockSummary,
                buildStockSummary(yesterdayFunds)
            );
        }

        await persistChanges(risk, formattedDate, 'fund', fundDiff);
        await persistChanges(risk, formattedDate, 'stock', stockChanges);

        runLog.comparisonStatus = 'completed';
        runLog.comparison = {
            fundsWithChanges: fundDiff.fundChanges.length,
            newFunds: fundDiff.newFunds.length,
            droppedFunds: fundDiff.droppedFunds.length,
            newStocks: stockChanges.newStocks.length,
            removedStocks: stockChanges.removedStocks.length,
        };

        log(
            risk,
            `Comparison done — ${fundDiff.fundChanges.length} funds changed, ` +
                `${fundDiff.newFunds.length} new, ${fundDiff.droppedFunds.length} dropped`
        );
    }

    const durationSec = Math.round((Date.now() - startTime) / 1000);
    runLog.durationMs = Date.now() - startTime;
    runLog.completedAt = new Date().toISOString();
    await persistRunLog(risk, formattedDate, runLog);
    log(risk, `Done in ${durationSec}s`);
};

const generateAllRisks = async () => {
    await connectToDatabase();
    const risks = [
        { type: 'Very High', percentage: 0 },
        { type: 'High', percentage: 0 },
        { type: 'Moderately High', percentage: 0 },
        { type: 'Moderate', percentage: 0 },
    ];

    for (const risk of risks) {
        await generateData(risk.type, risk.percentage);
    }
};

module.exports = { generateData, generateAllRisks };
