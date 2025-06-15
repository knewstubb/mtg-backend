const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const app = express();
const port = process.env.PORT;

app.use(cors());
app.use(express.json());

function escapeCsvField(field) {
    if (field === null || field === undefined) return '';
    const stringField = String(field);
    if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
        return `"${stringField.replace(/"/g, '""')}"`;
    }
    return stringField;
}

app.post('/export-csv', async (req, res) => {
    const { deckName = 'My Deck', cards = [] } = req.body;

    if (!cards.length) return res.status(400).json({ error: 'No cards provided' });

    const identifiers = cards.map(card => ({ name: card.name }));
    const cardDataMap = new Map();
    const chunkSize = 75;

    for (let i = 0; i < identifiers.length; i += chunkSize) {
        const chunk = identifiers.slice(i, i + chunkSize);
        const response = await fetch('https://api.scryfall.com/cards/collection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifiers: chunk })
        });
        if (!response.ok) {
            return res.status(500).json({ error: 'Scryfall lookup failed' });
        }
        const json = await response.json();
        json.data.forEach(card => cardDataMap.set(card.name, card));
    }

    const headers = ["Quantity", "Name", "Mana Cost", "Type Line", "Oracle Text", "Power", "Toughness"];
    let csv = headers.join(',') + '\n';

    cards.forEach(({ name, quantity }) => {
        const card = cardDataMap.get(name);
        if (!card) return;
        const row = [
            quantity, card.name, card.mana_cost || '', card.type_line || '',
            card.oracle_text || '', card.power || '', card.toughness || ''
        ].map(escapeCsvField).join(',');
        csv += row + '\n';
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${deckName.replace(/ /g, '_')}.csv"`);
    res.status(200).send(csv);
});

app.listen(port, '0.0.0.0', () => console.log(`Deck Export Server running on port ${port}`));
