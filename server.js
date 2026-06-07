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
    ASTER_INFO_API: 'https://fapi.asterdex.com/fapi/v1/fundingInfo',
};

// 緩存 Aster 的 interval 資訊
let asterIntervalCache = {};
let lastAsterInfoFetch = 0;

async function getAsterIntervals() {
    try {
        if (Date.now() - lastAsterInfoFetch > 3600000) { // 1小時更新一次即可
            const res = await axios.get(CONFIG.ASTER_INFO_API, { timeout: 10000 });
            const map = {};
            res.data.forEach(i => { map[i.symbol] = i.fundingIntervalHours || 8; });
            asterIntervalCache = map;
            lastAsterInfoFetch = Date.now();
        }
    } catch (e) { console.error("Error fetching Aster funding info:", e.message); }
    return asterIntervalCache;
}

function getIntervalHours(nextFundingTimeMs, symbol, platform, intervalMap = {}) {
    // 優先使用精確映射表
    if (platform === 'Aster' && intervalMap[symbol]) return intervalMap[symbol];
    
    // Hyperliquid 永遠是 1 小時
    if (platform === 'Hyperliquid' || platform === 'Hyna' || platform === 'TradeXYZ') return 1;

    if (!nextFundingTimeMs || nextFundingTimeMs == 0) return 8;
    const now = Date.now();
    const next = parseInt(nextFundingTimeMs);
    let diffHours = (next - now) / 3600000;
    
    if (diffHours < 0) {
        if (diffHours < -1) return 8; 
        return 8; 
    }

    if (diffHours <= 1.1) return 1;
    if (diffHours <= 2.1) return 2;
    if (diffHours <= 4.1) return 4;
    return 8;
}

async function getFundingData() {
    const data = [];
    const asterIntervals = await getAsterIntervals();
    const timeoutOpt = { timeout: 10000 }; // 10s timeout to prevent hanging
    
    try {
        // 1. Hyperliquid (Main, XYZ, Hyna)
        const hlDechs = ['', 'xyz', 'hyna'];
        for (const dex of hlDechs) {
            try {
                const res = await axios.post(CONFIG.HYPERLIQUID_API, { type: 'metaAndAssetCtxs', dex: dex || undefined }, timeoutOpt);
                const platformName = dex === 'hyna' ? 'Hyna' : (dex === 'xyz' ? 'TradeXYZ' : 'Hyperliquid');
                res.data[0].universe.forEach((asset, i) => {
                    const ctx = res.data[1][i];
                    if (ctx?.funding) {
                        const intervalHours = 1; // HL is always 1h interval
                        // HL APR calculation fix: (rate * (24/1) * 365 * 100)
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
            const res = await axios.get(CONFIG.BINANCE_API, timeoutOpt);
            res.data.forEach(item => {
                const intervalHours = getIntervalHours(item.nextFundingTime, item.symbol, 'Binance');
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
            const res = await axios.get(CONFIG.BYBIT_API, timeoutOpt);
            res.data.result.list.forEach(item => {
                const intervalHours = getIntervalHours(item.nextFundingTime, item.symbol, 'Bybit');
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
            const res = await axios.get(CONFIG.ASTER_API, timeoutOpt);
            res.data.forEach(item => {
                const intervalHours = getIntervalHours(item.nextFundingTime, item.symbol, 'Aster', asterIntervals);
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

let fundingDataCache = null;
let lastFundingFetch = 0;
const CACHE_TTL = 30000; // 30 seconds

app.get('/api/funding', async (req, res) => {
    if (fundingDataCache && Date.now() - lastFundingFetch < CACHE_TTL) {
        return res.json(fundingDataCache);
    }
    const data = await getFundingData();
    fundingDataCache = data;
    lastFundingFetch = Date.now();
    res.json(data);
});

app.listen(port, () => {
    console.log(`Funding Dashboard API running at http://localhost:${port}`);
});
