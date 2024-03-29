const fetch = require("fetch-retry")(global.fetch);

const extractPageText = async (id: string, totalPages: number) => {
  const baseUrl = `https://drive.google.com/viewer2/prod-01/presspage?ck=drive&ds=${id}&authuser=0&page=`;
  const regexText = /(?<=,")([^"]+)(?="])/g;
  const promises = Array.from({ length: totalPages }, (_, i) => {
    const url = baseUrl + i;
    return fetch(url, {
      retries: 3,
      retryDelay: 1000,
    });
  });

  const response = await Promise.all(promises).then((responses) =>
    Promise.all(responses.map((res) => res.text()))
  );
  return response.join().match(regexText)?.join(" ");
};

const getTotalPages = async (url: string): Promise<number> => {
  const response = await fetch(url);
  const data = await response.text();
  const cleanedData = data.replace(`)]}'`, "");
  return JSON.parse(cleanedData).pages;
};

const extractInfo = async (
  link: string
): Promise<{ url: string; id: string }> => {
  const regexFullPageNumber =
    /https:\/\/drive\.google\.com\/viewer2\/.*\/meta\?[^"]+/gi;
  const regexId = /(?<=ds=).*/gi;

  const response = await fetch(link);
  const text = await response.text();
  const url = decodeURIComponent(
    JSON.parse(`"${text.match(regexFullPageNumber)[0]}"`)
  );
  const id = url.match(regexId)![0];

  return {
    url,
    id,
  };
};

const pdfToText = async (link: string): Promise<string | undefined> => {
  const linkInfo = await extractInfo(link);
  const totalPages = await getTotalPages(linkInfo.url);
  const extractedText = await extractPageText(linkInfo.id, totalPages);
  return extractedText;
};

export default { getTotalPages, pdfToText, extractPageText };
