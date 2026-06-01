import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID;

if (!APIFY_TOKEN) {
    console.error('ERROR: APIFY_TOKEN environment variable is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
}
if (!APIFY_ACTOR_ID) {
    console.error('ERROR: APIFY_ACTOR_ID environment variable is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Start a new actor run
app.post('/api/run', async (req, res) => {
    const { jobTitles, locations, country, maxResultsPerSearch } = req.body;

    if (!Array.isArray(jobTitles) || jobTitles.length === 0) {
        return res.status(400).json({ error: 'At least one job title is required.' });
    }
    if (!Array.isArray(locations) || locations.length === 0) {
        return res.status(400).json({ error: 'At least one location is required.' });
    }

    const input = {
        jobTitles: jobTitles.map((t) => t.trim()).filter(Boolean),
        locations: locations.map((l) => l.trim()).filter(Boolean),
        country: country || 'us',
        maxResultsPerSearch: parseInt(maxResultsPerSearch) > 0 ? parseInt(maxResultsPerSearch) : 0,
        scrapeCompanyInfo: false,
    };

    try {
        const response = await fetch(
            `https://api.apify.com/v2/acts/${encodeURIComponent(APIFY_ACTOR_ID)}/runs?token=${APIFY_TOKEN}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            },
        );

        const data = await response.json();

        if (!response.ok) {
            const message = data?.error?.message ?? response.statusText;
            return res.status(response.status).json({ error: `Apify error: ${message}` });
        }

        return res.json({ runId: data.data.id });
    } catch (err) {
        return res.status(500).json({ error: `Server error: ${err.message}` });
    }
});

// Poll run status
app.get('/api/status/:runId', async (req, res) => {
    const { runId } = req.params;

    try {
        const response = await fetch(
            `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`,
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Run not found.' });
        }

        const { status, stats } = data.data;
        return res.json({
            status,
            jobsFound: stats?.datasetItems ?? 0,
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Fetch dataset results once run is complete — paginate through all items
app.get('/api/results/:runId', async (req, res) => {
    const { runId } = req.params;
    const PAGE_SIZE = 1000;
    const allItems = [];
    let offset = 0;

    try {
        while (true) {
            const response = await fetch(
                `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_TOKEN}&limit=${PAGE_SIZE}&offset=${offset}&clean=true`,
            );

            if (!response.ok) {
                return res.status(response.status).json({ error: 'Could not fetch results.' });
            }

            const page = await response.json();
            allItems.push(...page);

            if (page.length < PAGE_SIZE) break; // reached last page
            offset += PAGE_SIZE;
        }

        return res.json({ items: allItems });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

const PORT = parseInt(process.env.PORT ?? '3000', 10);
app.listen(PORT, () => {
    console.log(`Indeed Scraper web UI running at http://localhost:${PORT}`);
});
