const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

// --- Game classes ---
class Card {
    constructor(cardData) {
        this.id = cardData.id;
        this.name = cardData.name;
        this.manaCost = cardData.mana_cost;
        this.typeLine = cardData.type_line;
        this.oracleText = cardData.oracle_text;
        this.power = cardData.power;
        this.toughness = cardData.toughness;
        this.imageUris = cardData.image_uris;
    }
}

class Player {
    constructor(name, decklist) {
        this.name = name;
        this.life = 40;
        this.library = this.createDeck(decklist);
        this.hand = [];
        this.graveyard = [];
        this.battlefield = [];
        this.exile = [];
        this.shuffleLibrary();
    }

    createDeck(decklist) {
        const deck = [];
        decklist.forEach(cardInfo => {
            for (let i = 0; i < cardInfo.quantity; i++) {
                deck.push(new Card(cardInfo.cardData));
            }
        });
        return deck;
    }

    shuffleLibrary() {
        for (let i = this.library.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.library[i], this.library[j]] = [this.library[j], this.library[i]];
        }
    }

    draw(numCards = 1) {
        for (let i = 0; i < numCards; i++) {
            if (this.library.length > 0) {
                const card = this.library.pop();
                this.hand.push(card);
                console.log(`${this.name} drew ${card.name}.`);
            }
        }
    }
}

class Game {
    constructor(playerConfigs) {
        this.players = playerConfigs.map(config => new Player(config.name, config.decklist));
        this.turn = 1;
        this.phaseOrder = ['beginning', 'precombat main', 'combat', 'postcombat main', 'ending'];
        this.stepOrder = {
            beginning: ['untap', 'upkeep', 'draw'],
            combat: ['beginning of combat', 'declare attackers', 'declare blockers', 'combat damage', 'end of combat'],
            ending: ['end', 'cleanup']
        };
        this.phaseIndex = 0;
        this.stepIndex = -1;
        this.activePlayerIndex = 0;
    }

    startGame() {
        this.players.forEach(player => player.draw(7));
    }

    advance() {
        const currentPhase = this.phaseOrder[this.phaseIndex];
        const stepsInPhase = this.stepOrder[currentPhase];

        if (stepsInPhase) {
            this.stepIndex++;
            if (this.stepIndex >= stepsInPhase.length) {
                this.advanceToNextPhase();
            } else {
                this.executeStepActions(stepsInPhase[this.stepIndex]);
            }
        } else {
            this.advanceToNextPhase();
        }
    }

    advanceToNextPhase() {
        this.phaseIndex++;
        this.stepIndex = -1;
        if (this.phaseIndex >= this.phaseOrder.length) {
            this.phaseIndex = 0;
            this.turn++;
            this.activePlayerIndex = (this.activePlayerIndex + 1) % this.players.length;
        }
        this.advance();
    }

    executeStepActions(step) {
        const player = this.players[this.activePlayerIndex];
        if (step === 'draw' && this.turn > 1) {
            player.draw(1);
        }
    }

    getPhase() { return this.phaseOrder[this.phaseIndex]; }
    getStep() {
        const phase = this.getPhase();
        if (this.stepOrder[phase] && this.stepIndex >= 0) {
            return this.stepOrder[phase][this.stepIndex];
        }
        return 'main';
    }
}

// --- Express setup ---
const app = express();
const port = process.env.PORT;
app.use(cors());
app.use(express.json());

let activeGame = null;

async function fetchDecklist(url) {
    let simpleCardList, deckApiUrl, siteName, deckName = 'Imported Deck', commanderName = 'Unknown';

    if (url.includes('archidekt.com/decks/')) {
        const deckId = url.split('/decks/')[1].split('/')[0];
        deckApiUrl = `https://archidekt.com/decks/${deckId}/export/txt`;
        siteName = 'Archidekt';
    } else {
        throw new Error('Only Archidekt URLs are supported at this time.');
    }

    const apiResponse = await fetch(deckApiUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0'
        }
    });

    if (!apiResponse.ok) {
        throw new Error(`Failed to fetch from ${siteName}, status: ${apiResponse.status}`);
    }

    const deckText = await apiResponse.text();

    simpleCardList = deckText
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const match = line.match(/^(\d+)x?\s+(.+)$/);
            if (!match) return null;
            return { quantity: parseInt(match[1]), name: match[2] };
        })
        .filter(Boolean);

    if (!simpleCardList || simpleCardList.length === 0) {
        throw new Error(`The deck from ${siteName} appears to be empty.`);
    }

    const allIdentifiers = simpleCardList.map(card => ({ name: card.name }));
    const cardDataMap = new Map();
    const chunkSize = 75;

    for (let i = 0; i < allIdentifiers.length; i += chunkSize) {
        const chunk = allIdentifiers.slice(i, i + chunkSize);
        const scryfallResponse = await fetch('https://api.scryfall.com/cards/collection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifiers: chunk })
        });
        if (!scryfallResponse.ok) throw new Error('Failed to fetch card data from Scryfall.');
        const scryfallCollection = await scryfallResponse.json();
        if (scryfallCollection.data) {
            scryfallCollection.data.forEach(card => cardDataMap.set(card.name, card));
        }
    }

    const fullDecklist = simpleCardList.map(item => ({
        quantity: item.quantity,
        cardData: cardDataMap.get(item.name)
    })).filter(item => item.cardData);

    return { decklist: fullDecklist, deckName, commanderName };
}

app.post('/create-game', async (req, res) => {
    const { deckUrl } = req.body;
    if (!deckUrl) return res.status(400).json({ error: 'deckUrl is required' });

    try {
        const playerDeck = await fetchDecklist(deckUrl);
        const playerConfigs = [
            { name: 'Player 1', decklist: playerDeck.decklist, deckName: playerDeck.deckName, commanderName: playerDeck.commanderName },
            { name: 'AI Opponent', decklist: playerDeck.decklist, deckName: 'Mirror', commanderName: playerDeck.commanderName }
        ];
        activeGame = new Game(playerConfigs);
        activeGame.startGame();
        res.json(getGameStateForClient(activeGame, playerConfigs));
    } catch (error) {
        console.error('Game Creation Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/next-phase', (req, res) => {
    if (!activeGame) return res.status(404).json({ error: "No active game found." });
    try {
        activeGame.advance();
        const playerConfigs = activeGame.players.map(p => ({ deckName: p.deckName, commanderName: p.commanderName }));
        res.json(getGameStateForClient(activeGame, playerConfigs));
    } catch (error) {
        console.error("Error advancing phase:", error);
        res.status(500).json({ error: "Failed to advance game state." });
    }
});

app.post('/export-csv', async (req, res) => {
    const { deckUrl } = req.body;
    if (!deckUrl) return res.status(400).json({ error: 'deckUrl is required' });

    try {
        const { decklist, deckName } = await fetchDecklist(deckUrl);
        const escapeCsvField = (field) => {
            if (field === null || field === undefined) return '';
            const stringField = String(field);
            if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
                return `"${stringField.replace(/"/g, '""')}"`;
            }
            return stringField;
        };
        const headers = ["Quantity", "Name", "Mana Cost", "Type Line", "Oracle Text", "Power", "Toughness"];
        let csvContent = headers.join(',') + '\r\n';
        decklist.forEach(item => {
            const card = item.cardData;
            const row = [
                item.quantity, card.name, card.manaCost || '', card.typeLine,
                card.oracleText || '', card.power || '', card.toughness || ''
            ].map(escapeCsvField).join(',');
            csvContent += row + '\r\n';
        });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${deckName.replace(/ /g, '_')}.csv"`);
        res.status(200).send(csvContent);
    } catch (error) {
        console.error("CSV Export Error:", error);
        res.status(500).json({ error: "Failed to generate CSV file." });
    }
});

function getGameStateForClient(game, playerConfigs) {
    const activePlayer = game.players[game.activePlayerIndex];
    game.players.forEach((p, index) => {
        p.deckName = playerConfigs[index].deckName;
        p.commanderName = playerConfigs[index].commanderName;
    });
    return {
        turn: game.turn,
        phase: game.getPhase(),
        step: game.getStep(),
        activePlayerName: activePlayer.name,
        players: game.players.map(p => ({
            name: p.name,
            life: p.life,
            handCount: p.hand.length,
            libraryCount: p.library.length,
            graveyardCount: p.graveyard.length,
            hand: p.name === 'Player 1' ? p.hand : [],
            deckName: p.deckName,
            commanderName: p.commanderName
        }))
    };
}

app.get('/health', (req, res) => res.status(200).send('Server is running'));

app.listen(port, '0.0.0.0', () => console.log(`MTG Game Server listening on port ${port}`));
