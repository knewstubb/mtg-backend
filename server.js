// Filename: server.js
// Version 1.3: Replaced dynamic precon fetching with a static list for reliability.

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
        this.stepIndex = -1; // Start before the first step
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

// ** NEW **: Using a static list of precons for reliability.
const PRECON_DECK_IDS = [
    '6394111', // Draconic Dissent (Baldur's Gate)
    '6262947', // Upgrades Unleashed (Kamigawa)
    '4444557', // Undead Unleashed (Innistrad)
    '3392350', // Silverquill Statement (Strixhaven)
    '2305822'  // Aesi's Monster-ous Wake (Commander Legends)
];


// Fetches a decklist from Archidekt or Moxfield
async function fetchDecklist(url) {
    let simpleCardList;
    let deckApiUrl;
    let siteName;
    let deckName = 'Custom Deck';
    let commanderName = 'Unknown';

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
    if (!apiResponse.ok) throw new Error(`Failed to fetch from ${siteName}, status: ${apiResponse.status}`);
    const deckData = await apiResponse.json();

    deckName = deckData.name;

    if (siteName === 'Moxfield') {
        commanderName = deckData.commanders[0]?.card?.name || 'Unknown';
        simpleCardList = Object.values(deckData.mainboard).map(card => ({ name: card.card.name, quantity: card.quantity }));
    } else { // Archidekt
        const commander = deckData.cards.find(c => c.category === "Commander");
        commanderName = commander?.card?.oracleCard?.name || 'Unknown';
        simpleCardList = deckData.cards.filter(c => c.category === "Mainboard").map(card => ({ name: card.card.oracleCard.name, quantity: card.quantity }));
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
        scryfallCollection.data.forEach(card => cardDataMap.set(card.name, card));
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
        console.log(`Selected random AI precon ID: ${randomPreconId}`);
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
    if (!activeGame) {
        return res.status(404).json({ error: "No active game found. Please create a game first." });
    }
    try {
        activeGame.advance();
        const playerConfigs = activeGame.players.map(p => ({ deckName: p.deckName, commanderName: p.commanderName }));
        res.json(getGameStateForClient(activeGame, playerConfigs));
    } catch (error) {
        console.error("Error advancing phase:", error);
        res.status(500).json({ error: "Failed to advance game state." });
    }
});

function getGameStateForClient(game, playerConfigs) {
    if (!game) return null;
    const activePlayer = game.players[game.activePlayerIndex];
    return {
        turn: game.turn,
        phase: game.getPhase(),
        step: game.getStep(),
        activePlayerName: activePlayer.name,
        players: game.players.map((p, index) => ({
            name: p.name,
            life: p.life,
            handCount: p.hand.length,
            libraryCount: p.library.length,
            graveyardCount: p.graveyard.length,
            hand: p.name === 'Player 1' ? p.hand : [],
            deckName: playerConfigs[index].deckName,
            commanderName: playerConfigs[index].commanderName
        }))
    };
}

app.get('/health', (req, res) => {
    res.status(200).send('Server is running');
});

app.listen(port, '0.0.0.0', () => {
    console.log(`MTG Game Server listening on port ${port}`);
});
