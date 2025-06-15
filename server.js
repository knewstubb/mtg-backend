async function fetchDecklist(url) {
    let simpleCardList, deckApiUrl, siteName, deckName = 'Imported Deck', commanderName = 'Unknown';

    if (url.includes('archidekt.com/decks/')) {
        const deckId = url.split('/decks/')[1].split('/')[0];
        deckApiUrl = `https://archidekt.com/api/decks/${deckId}/export/txt`;
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
