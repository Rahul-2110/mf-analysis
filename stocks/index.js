const { default: axios } = require('axios');
const fs = require('fs');
const path = require('path');
const promises = [];

const saveFile = (fileName, data) => {
    const folderPath = path.dirname(fileName);

    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }

    fs.writeFile(fileName, JSON.stringify(data), (err) => {
        if (err) {
            console.error('Error writing to file', err);
        } else {
            console.log('File has been written');
        }
    });
}

const getMutualFundsListPage = async (risk, page) => {
    let data = await axios.get(`https://groww.in/v1/api/search/v1/derived/scheme`,
        {
            params: {
                plan_type: 'Direct',
                q: '',
                risk: risk,
                available_for_investment: true,
                doc_type: 'scheme',
                page_no: page,
                size: 20
            }
        });
    return data.data.content;

}
const getMutualFundsList = async (risk) => {
    try {
        let data = await axios.get(`https://groww.in/v1/api/search/v1/derived/scheme`,
            {
                params: {
                    plan_type: 'Direct',
                    q: '',
                    risk: risk,
                    available_for_investment: true,
                    doc_type: 'scheme',
                    page_no: 1,
                    size: 20
                }
            });

        let totalPages = Math.round(data.data.total_results / 20) + 1;

        if (totalPages > 1) {
            const promises = []
            for (let i = 2; i <= totalPages; i++) {
                promises.push(getMutualFundsListPage(risk, i));
            }

            const funds = await Promise.all(promises)
            funds.forEach(fund => {
                data.data.content.push(...fund);
            });
        }

        return data.data;
    }
    catch (error) {
        console.log(error.message);
        return []
    }
}


const getFundData = async (fund) => {
    try {
        let data = await axios.get(`https://groww.in/v1/api/data/mf/web/v4/scheme/search/${fund}`);
        return data.data.holdings;
    } catch (error) {
        console.log(error.message);
        return []
    }
}


const date = new Date();


const day = String(date.getDate()).padStart(2, '0');
const month = String(date.getMonth() + 1).padStart(2, '0');
const year = String(date.getFullYear()).slice(-2);

const formattedDate = `${day}-${month}-${year}`;

const generateData = async (risk, percentage) => {
    let funds = await getMutualFundsList(risk);
    saveFile(`search/${risk.replace(/ /g, '-')}/funds-${formattedDate}.json`, funds);
    let stocksMap = {};

    let filteredFundsList = [];
    funds.content.forEach((fund) => {
        if (fund.return1y > percentage) {
            filteredFundsList.push(fund);
            promises.push(getFundData(fund.search_id))
        }
    });

    saveFile(`results/${risk.replace(/ /g, '-')}/mutual_funds-${formattedDate}.json`, filteredFundsList);

    if(filteredFundsList.length === 0) {
        return;
    }
    const holdings = await Promise.all(promises)

    saveFile(`search/${risk.replace(/ /g, '-')}/holdings-${formattedDate}.json`, holdings);

   
    holdings.forEach(mutual_fund_holdings => {
        mutual_fund_holdings.forEach(stock => {
            if (!stocksMap[stock.company_name]) {
                stocksMap[stock.company_name] = { percentage: stock.corpus_per, count: 1 };
            } else {
                stocksMap[stock.company_name] = { percentage: stock.corpus_per + stocksMap[stock.company_name].percentage, count: stocksMap[stock.company_name].count + 1 };
            }
        });
    });

    const stocksArray = []

    Object.keys(stocksMap).forEach(key => {
        stocksArray.push({
            name: key,
            percentage: stocksMap[key].percentage,
            count: stocksMap[key].count
        })
    });


    saveFile(`search/${risk.replace(/ /g, '-')}/all_stocks-${formattedDate}.json`, stocksMap);

    // let sortedStocksKeys = Object.keys(stocksMap).sort((a, b) => stocksMap[b].percentage - stocksMap[a].percentage);

    // let sortedStocks = {};
    // sortedStocksKeys.forEach(key => {
    //     sortedStocks[key] = stocksMap[key];
    // });

    saveFile(`results/${risk.replace(/ /g, '-')}/percentage_sorted_stocks-${formattedDate}.json`, stocksArray.sort((a, b) => b.percentage - a.percentage));


    // sortedStocksKeys = Object.keys(stocksMap).sort((a, b) => stocksMap[b].count - stocksMap[a].count);

    // sortedStocks = {};
    // sortedStocksKeys.forEach(key => {
    //     sortedStocks[key] = stocksMap[key];
    // });

    
    saveFile(`results/${risk.replace(/ /g, '-')}/occurance_sorted_stocks-${formattedDate}.json`, stocksArray.sort((a, b) => b.count - a.count));
}

(async () => {

    const risks = [{ type: 'Very High', percentage: 70 }, { type: 'High', percentage: 60 }, { type: 'Moderately High', percentage: 45 }, { type: 'Moderate', percentage: 40 }];

    for (let risk of risks) {
        await generateData(risk.type, risk.percentage)
    }

})();
