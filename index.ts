const fetch = require("fetch-retry")(global.fetch);

const extractPageText = async (id: string, totalPages: number, pw?: string) => {
    const baseUrl = `https://drive.google.com/viewer2/prod-01/presspage?ck=drive&ds=${id}&authuser=0&page=`;
    const regexText = /(?<=,")([^"]+)(?="])/g;
    const promises = Array.from({ length: totalPages }, (_, i) => {
        const url = baseUrl + i;
        const formData = new URLSearchParams();
        if (pw) {
            formData.append("pw", pw);
        }
        return fetch(url, {
            method: "POST",
            body: pw ? formData : undefined,
            retries: 5,
            retryDelay: 15000,
        });
    });

    const response = await Promise.all(promises).then((responses) => Promise.all(responses.map((res) => res.text())));
    return response.join().match(regexText)?.join(" ");
};

const getTotalPages = async (url: string, pw?: string): Promise<number> => {
    const formData = new URLSearchParams();
    if (pw) {
        formData.append("pw", pw);
    }
    const response = await fetch(url, {
        method: "POST",
        body: pw ? formData : undefined,
    });
    const data = await response.text();

    const cleanedData = data.replace(`)]}'`, "");
    const metaUrl = `https://drive.google.com/viewerng/${JSON.parse(cleanedData).meta}`;
    const metaResponse = await fetch(metaUrl, {
        method: "GET",
    });
    const metaCleanedData = (await metaResponse.text()).replace(`)]}'`, "");
    return JSON.parse(metaCleanedData).pages;
};

const extractInfo = async (link: string): Promise<{ url: string; id: string }> => {
    const regexFullPageNumber = /https:\/\/drive\.google\.com\/viewerng\/upload\?[^"]+/gi;
    const regexId = /(?<=ds=).*/gi;
    const response = await fetch(link);
    const text = await response.text();
    const url = decodeURIComponent(JSON.parse(`"${text.match(regexFullPageNumber)[0]}"`));
    const id = url.match(regexId)![0];

    return {
        url,
        id,
    };
};

const pdfToText = async (link: string, pw?: string): Promise<string | undefined> => {
    const linkInfo = await extractInfo(link);
    const totalPages = await getTotalPages(linkInfo.url, pw);
    const extractedText = await extractPageText(linkInfo.id, totalPages, pw);
    return extractedText;
};

export default { getTotalPages, pdfToText, extractPageText };
