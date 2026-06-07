const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const port = 3005;

app.use(cors());
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

const CONFIG = {
    HYPERLIQUID_API: 'https://api.hyperliquid.xyz/info',
    BINANCE_API: 'https://fapi.binance.com/fapi/v1/premiumIndex',
    BYBIT_API: 'https://api.bybit.com/v5/market/tickers?category=linear',
    ASTER_API: 'https://fapi.asterdex.com/fapi/v1/premiumIndex',
};

function getIntervalHours(nextFundingTimeMs) {
    if (!nextFundingTimeMs || nextFundingTimeMs == 0) return 8;
    const nextTs = Math.floor(parseInt(nextFundingTimeMs) / 1000);
    if (nextTs % 3600 !== 0) return 1;
    if (nextTs % 28800 === 0) return 8;
    if (nextTs % 14400 === 0) return 4;
    if (nextTs % 7200 === 0) return 2;
    return 1;
}

async function getFundingData() {
    const data = [];
    
    try {
        // 1. Hyperliquid (Main, XYZ, Hyna)
        const hlDechs = ['', 'xyz', 'hyna'];
        for (const dex of hlDechs) {
            try {
                const res = await axios.post(CONFIG.HYPERLIQUID_API, { type: 'metaAndAssetCtxs', dex: dex || undefined });
                const platformName = dex === 'hyna' ? 'Hyna' : (dex === 'xyz' ? 'TradeXYZ' : 'Hyperliquid');
                res.data[0].universe.forEach((asset, i) => {
                    const ctx = res.data[1][i];
                    if (ctx?.funding) {
                        const apr = parseFloat(ctx.funding) * 24 * 365 * 100;
                        if (apr > 0) {
                            data.push({
                                platform: platformName,
                                symbol: asset.name.replace(`${dex}:`, ''),
                                apr: apr,
                                hourly: parseFloat(ctx.funding) * 100
                            });
                        }
                    }
                });
            } catch (e) { console.error(`Error HL ${dex}:`, e.message); }
        }

        // 2. Binance
        try {
            const res = await axios.get(CONFIG.BINANCE_API);
            res.data.forEach(item => {
                const intervalHours = getIntervalHours(item.nextFundingTime);
                const apr = parseFloat(item.lastFundingRate) * (24 / intervalHours) * 365 * 100;
                if (apr > 0) {
                    data.push({
                        platform: 'Binance',
                        symbol: item.symbol,
                        apr: apr,
                        hourly: (parseFloat(item.lastFundingRate) * 100) / intervalHours
                    });
                }
            });
        } catch (e) { console.error("Error Binance:", e.message); }

        // 3. Bybit
        try {
            const res = await axios.get(CONFIG.BYBIT_API);
            res.data.result.list.forEach(item => {
                const intervalHours = getIntervalHours(item.nextFundingTime);
                const apr = parseFloat(item.fundingRate) * (24 / intervalHours) * 365 * 100;
                if (apr > 0) {
                    data.push({
                        platform: 'Bybit',
                        symbol: item.symbol,
                        apr: apr,
                        hourly: (parseFloat(item.fundingRate) * 100) / intervalHours
                    });
                }
            });
        } catch (e) { console.error("Error Bybit:", e.message); }

        // 4. Aster
        try {
            const res = await axios.get(CONFIG.ASTER_API);
            res.data.forEach(item => {
                const intervalHours = getIntervalHours(item.nextFundingTime);
                const apr = parseFloat(item.lastFundingRate) * (24 / intervalHours) * 365 * 100;
                if (apr > 0) {
                    data.push({
                        platform: 'Aster',
                        symbol: item.symbol,
                        apr: apr,
                        hourly: (parseFloat(item.lastFundingRate) * 100) / intervalHours
                    });
                }
            });
        } catch (e) { console.error("Error Aster:", e.message); }

    } catch (globalError) {
        console.error("Global fetch error:", globalError);
    }

    return data.sort((a, b) => b.apr - a.apr);
}

app.get('/api/funding', async (req, res) => {
    const data = await getFundingData();
    res.json(data);
});

app.listen(port, () => {
    console.log(`Funding Dashboard API running at http://localhost:${port}`);
});
