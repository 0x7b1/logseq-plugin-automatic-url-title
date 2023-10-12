import '@logseq/libs';

const DEFAULT_REGEX = {
    wrappedInCommand: /(\{\{(video)\s*(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})\s*\}\})/gi,
    wrappedInCodeTags: /((`|```).*(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,}).*(`|```))/gi,
    htmlTitleTag: /<title(\s[^>]+)*>([^<]*)<\/title>/,
    line: /(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})/gi,
    imageExtension: /\.(gif|jpe?g|tiff?|png|webp|bmp|tga|psd|ai)$/i,
};

const FORMAT_SETTINGS = {
    markdown: {
        formatBeginning: '](',
        applyFormat: (title, url) => `[${title}](${url})`,
    },
    org: {
        formatBeginning: '][',
        applyFormat: (title, url) => `[[${url}][${title}]]`,
    },
};

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
        const matches = responseText.match(DEFAULT_REGEX.htmlTitleTag);
        if (matches !== null && matches.length > 1 && matches[2] !== null) {
            return decodeHTML(matches[2].trim());
        }
    } catch (e) {
        console.error(e);
    }

    return '';
}

async function convertUrlToMarkdownLink(url, text, urlStartIndex, offset, applyFormat) {
    const title = await getTitle(url);
    if (title === '') {
        return { text, offset };
    }

    const startSection = text.slice(0, urlStartIndex);
    const wrappedUrl = applyFormat(title, url);
    const endSection = text.slice(urlStartIndex + url.length);

    return {
        text: `${startSection}${wrappedUrl}${endSection}`,
        offset: urlStartIndex + url.length,
    };
}

function isImage(url) {
    const imageRegex = new RegExp(DEFAULT_REGEX.imageExtension);
    return imageRegex.test(url);
}

function isAlreadyFormatted(text, url, urlIndex, formatBeginning) {
    return text.slice(urlIndex - 2, urlIndex) === formatBeginning;
}

function isWrappedInCodeTags(text, url) {
    const wrappedLinks = text.match(DEFAULT_REGEX.wrappedInCodeTags);
    if (!wrappedLinks) {
        return false;
    }

    return wrappedLinks.some(command => command.includes(url));
}

function isWrappedInCommand(text, url) {
    const wrappedLinks = text.match(DEFAULT_REGEX.wrappedInCommand);
    if (!wrappedLinks) {
        return false;
    }

    return wrappedLinks.some(command => command.includes(url));
}

async function getFormatSettings() {
    const { preferredFormat } = await logseq.App.getUserConfigs();
    if (!preferredFormat) {
        return null;
    }

    return FORMAT_SETTINGS[preferredFormat];
}

async function parseBlockForLink(uuid: string) {
    if (!uuid) {
        return;
    }

    const rawBlock = await logseq.Editor.getBlock(uuid);
    if (!rawBlock) {
        return;
    }

    let text = rawBlock.content;
    const urls = text.match(DEFAULT_REGEX.line);
    if (!urls) {
        return;
    }

    const formatSettings = await getFormatSettings();
    if (!formatSettings) {
        return;
    }

    let offset = 0;
    for (const url of urls) {
        const urlIndex = text.indexOf(url, offset);

        if (isAlreadyFormatted(text, url, urlIndex, formatSettings.formatBeginning) || isImage(url) || isWrappedInCommand(text, url) || isWrappedInCodeTags(text, url)) {
            continue;
        }

        const updatedTitle = await convertUrlToMarkdownLink(url, text, urlIndex, offset, formatSettings.applyFormat);
        text = updatedTitle.text;
        offset = updatedTitle.offset;
    }

    await logseq.Editor.updateBlock(uuid, text);
}

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
        display: var(--favicons, inline-block);
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
        const faviconValue = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
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
        doc.querySelectorAll('.external-link')?.forEach(extLink => setFavicon(extLink));
        extLinksObserver.observe(appContainer, extLinksObserverConfig);
    }, 500);

    logseq.Editor.registerBlockContextMenuItem('Format url titles', async ({ uuid }) => {
        await parseBlockForLink(uuid);
        const extLinkList: NodeListOf<HTMLAnchorElement> = doc.querySelectorAll('.external-link');
        extLinkList.forEach(extLink => setFavicon(extLink));
    });

    const blockSet = new Set();
    logseq.DB.onChanged(async (e) => {
        if (e.txMeta?.outlinerOp !== 'insertBlocks') {
            blockSet.add(e.blocks[0]?.uuid);
            doc.querySelectorAll('.external-link')?.forEach(extLink => setFavicon(extLink));
            return;
        }

        await blockSet.forEach((uuid) => parseBlockForLink(uuid));
        blockSet.clear();
    });
};

logseq.ready(main).catch(console.error);
