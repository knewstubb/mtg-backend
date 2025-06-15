// Filename: server.js
// Version 1.6: Adds a check to ensure a decklist is not empty after fetching.

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

// --- Start: Inlined from game.js ---
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
        console.log(`${this.name} is shuffling their library.`);
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
            } else {
                console.log(`${this.name} tried to draw a card, but their library is empty.`);
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
        console.log("Game created with players:", this.players.map(p => p.name).join(', '));
    }

    startGame() {
        console.log("--- The game is starting! ---");
        this.players.forEach(player => {
            player.draw(7);
        });
        this.logGameState();
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
        
        console.log(`Advancing to: Turn ${this.turn}, Phase: ${this.getPhase()}, Step: ${this.getStep()}`);
        this.logGameState();
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
        } else if (step === 'draw' && this.turn === 1) {
            console.log(`${player.name} skips their first draw step.`);
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
    
    logGameState() {
        console.log("--- Current Game State ---");
        this.players.forEach(player => {
            console.log(
                `${player.name} | Life: ${player.life} | Library: ${player.library.length} | Hand: ${player.hand.length}`
            );
        });
        console.log("--------------------------");
    }
}
// --- End: Inlined from game.js ---


const app = express();
const port = process.env.PORT || 3000;

app.use(cors()); 
app.use(express.json());

let activeGame = null;

const PRECON_DECK_IDS = [
    '6394111', '6262947', '4444557', '3392350', '2305822'
];

async function fetchDecklist(url) {
    let simpleCardList, deckApiUrl, siteName, deckName = 'Custom Deck', commanderName = 'Unknown';

    if (url.includes('moxfield.com/decks/')) {
        const deckId = url.split('/decks/')[1].split('/')[0];
        deckApiUrl = `https://api.moxfield.com/v2/decks/all/${deckId}`;
        siteName = 'Moxfield';
    } else if (url.includes('archidekt.com/decks/')) {
        const deckId = url.split('/decks/')[1].split('/')[0];
        deckApiUrl = `https://archidekt.com/api/decks/${deckId}/`;
        siteName = 'Archidekt';
    } else {
        throw new Error('Invalid or unsupported URL');
    }

    const apiResponse = await fetch(deckApiUrl);
    
    if (!apiResponse.ok) {
        let errorDetails = `Failed to fetch from ${siteName}, status: ${apiResponse.status}`;
        try {
            const errorJson = await apiResponse.json();
            if (errorJson.detail) {
                errorDetails += `. Reason: ${errorJson.detail}`;
            }
        } catch (e) { /* Ignore JSON parsing errors */ }
        throw new Error(errorDetails);
    }
    
    const deckData = await apiResponse.json();

    deckName = deckData.name;

    if (siteName === 'Moxfield') {
        const commanders = Object.values(deckData.commanders);
        commanderName = commanders.map(c => c.card.name).join(' & ') || 'Unknown';
        const allCardsInDeck = { ...deckData.mainboard, ...deckData.commanders };
        simpleCardList = Object.values(allCardsInDeck).map(card => ({ name: card.card.name, quantity: card.quantity }));
    } else {
        const commanders = deckData.cards.filter(c => c.category === "Commander");
        commanderName = commanders.map(c => c.card.oracleCard.name).join(' & ') || 'Unknown';
        const allCardsForDeck = deckData.cards.filter(c => c.category === "Mainboard" || c.category === "Commander");
        const nameToQuantityMap = new Map();
        allCardsForDeck.forEach(c => {
            const name = c.card.oracleCard.name;
            nameToQuantityMap.set(name, (nameToQuantityMap.get(name) || 0) + c.quantity);
        });
        simpleCardList = Array.from(nameToQuantityMap, ([name, quantity]) => ({ name, quantity }));
    }
    
    // ** NEW: Error check for empty deck **
    if (!simpleCardList || simpleCardList.length === 0) {
        throw new Error(`The deck from ${siteName} appears to be empty or private. No cards were found.`);
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
        if (!scryfallResponse.ok) throw new Error('Failed to fetch a chunk of card data from Scryfall.');
        const scryfallCollection = await scryfallResponse.json();
        if(scryfallCollection.data) {
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
    console.log(`Received request to create game with URL: ${deckUrl}`);

    try {
        const playerDeck = await fetchDecklist(deckUrl);
        const randomPreconId = PRECON_DECK_IDS[Math.floor(Math.random() * PRECON_DECK_IDS.length)];
        const aiDeck = await fetchDecklist(`https://archidekt.com/decks/${randomPreconId}`);
        const playerConfigs = [
            { name: 'Player 1', decklist: playerDeck.decklist, deckName: playerDeck.deckName, commanderName: playerDeck.commanderName },
            { name: 'AI Opponent', decklist: aiDeck.decklist, deckName: aiDeck.deckName, commanderName: aiDeck.commanderName }
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
    console.log(`Received request to export CSV for URL: ${deckUrl}`);

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
    if (!game) return null;
    const activePlayer = game.players[game.activePlayerIndex];
    game.players.forEach((p, index) => {
        p.deckName = playerConfigs[index].deckName;
        p.commanderName = playerConfigs[index].commanderName;
    });
    return {
        turn: game.turn, phase: game.getPhase(), step: game.getStep(), activePlayerName: activePlayer.name,
        players: game.players.map(p => ({
            name: p.name, life: p.life, handCount: p.hand.length, libraryCount: p.library.length,
            graveyardCount: p.graveyard.length, hand: p.name === 'Player 1' ? p.hand : [],
            deckName: p.deckName, commanderName: p.commanderName
        }))
    };
}

app.get('/health', (req, res) => res.status(200).send('Server is running'));

app.listen(port, '0.0.0.0', () => console.log(`MTG Game Server listening on port ${port}`));
