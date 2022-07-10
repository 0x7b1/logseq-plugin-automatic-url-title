import '@logseq/libs';

function decodeHTML(input) {
    if (!input) {
        return '';
    }

    const doc = new DOMParser().parseFromString(input, 'text/html');
    return doc.documentElement.textContent;
}

async function getTitle(url) {
    try {
        const response = await fetch(url);
        const responseText = await response.text();
        const matches = responseText.match(/<title(\s[^>]+)*>([^<]*)<\/title>/);
        if (matches !== null && matches.length > 1 && matches[2] !== null) {
            return decodeHTML(matches[2].trim());
        }
    } catch (e) {
        console.error(e);
    }

    return '';
}

async function convertUrlToMarkdownLink(url, text, urlStartIndex, offset) {
    try {
        const title = await getTitle(url);
        if (title === '') {
            return { text, offset };
        }

        const startSection = text.slice(0, urlStartIndex);
        const wrappedUrl = `[${title}](${url})`;
        const endSection = text.slice(urlStartIndex + url.length);

        return {
            text: `${startSection}${wrappedUrl}${endSection}`,
            offset: urlStartIndex + url.length,
        };
    } catch (e) {

    }

}

const DEFAULT_SETTINGS = {
    lineRegex:
        /(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})/gi,
    linkRegex:
        /^\[([^\[\]]*)\]\((https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})\)$/i,
    imageRegex: /\.(gif|jpe?g|tiff?|png|webp|bmp|tga|psd|ai)$/i,
};

function isImage(url) {
    const imageRegex = new RegExp(DEFAULT_SETTINGS.imageRegex);
    return imageRegex.test(url);
}

function isMarkdownLinkAlready(text, url, urlIndex) {
    return text.slice(urlIndex - 2, urlIndex) === '](';
}

async function parseBlockForLink(uuid: string) {
    if (!uuid) {
        return;
    }

    const { content } = await logseq.Editor.getBlock(uuid);
    let text = content;

    const urls = text.match(DEFAULT_SETTINGS.lineRegex);
    if (!urls) {
        return;
    }

    let offset = 0;
    for (const url of urls) {
        const urlIndex = text.indexOf(url, offset);

        if (isMarkdownLinkAlready(text, url, urlIndex) || isImage(url)) {
            continue;
        }

        const updatedTitle = await convertUrlToMarkdownLink(url, text, urlIndex, offset);
        text = updatedTitle.text;
        offset = updatedTitle.offset;
    }

    await logseq.Editor.updateBlock(uuid, text);
}

let blockArray = []; // TODO: this could be a set instead

const main = async () => {
    logseq.provideStyle(`
    .external-link {
        padding: 2px 4px;
        border-radius: 3px;
        border: 0;
        text-decoration: underline;
        text-decoration-style: dashed;
        text-decoration-thickness: 1px;
        text-underline-offset: 2px;
    }
    .external-link-img {
        display: var(--favicons, none);
        width: 16px;
        height: 16px;
        margin: -3px 7px 0 0;
    }`);

    const doc = parent.document;
    const appContainer = doc.getElementById('app-container');

    // External links favicons
    const setFavicon = (extLinkEl: HTMLAnchorElement) => {
        const oldFav = extLinkEl.querySelector('.external-link-img');
        if (oldFav) {
            oldFav.remove();
        }
        const { hostname } = new URL(extLinkEl.href);
        const faviconValue = `https://www.google.com/s2/favicons?domain=${hostname}&sz=16`;
        const fav = doc.createElement('img');
        fav.src = faviconValue;
        fav.width = 16;
        fav.height = 16;
        fav.classList.add('external-link-img');
        extLinkEl.insertAdjacentElement('afterbegin', fav);
    };

    // Favicons observer
    const extLinksObserverConfig = { childList: true, subtree: true };
    const extLinksObserver = new MutationObserver((mutationsList, observer) => {
        for (let i = 0; i < mutationsList.length; i++) {
            const addedNode = mutationsList[i].addedNodes[0];
            if (addedNode && addedNode.childNodes.length) {
                const extLinkList = addedNode.querySelectorAll('.external-link');
                if (extLinkList.length) {
                    extLinksObserver.disconnect();
                    for (let i = 0; i < extLinkList.length; i++) {
                        setFavicon(extLinkList[i]);
                    }
                    extLinksObserver.observe(appContainer, extLinksObserverConfig);
                }
            }
        }
    });

    setTimeout(() => {
        const extLinkList: NodeListOf<HTMLAnchorElement> = doc.querySelectorAll('.external-link');
        extLinkList.forEach(extLink => setFavicon(extLink));
        extLinksObserver.observe(appContainer, extLinksObserverConfig);
    }, 500);

    logseq.Editor.registerBlockContextMenuItem('Get link titles', async ({ uuid }) => {
        await parseBlockForLink(uuid);
    });

    logseq.DB.onChanged(async (e) => {
        if (e.txMeta?.outlinerOp === 'insertBlocks') {
            await blockArray.forEach(parseBlockForLink);
            blockArray = [];
        } else {
            const block = e.blocks[0].uuid;
            if (!blockArray.includes(block)) {
                blockArray.push(block);
            }
        }
    });
};

logseq.ready(main).catch(console.error);
