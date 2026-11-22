const { pdfToText } = require("../dist/index.js");

const link = process.argv[2]
    ?? "https://drive.google.com/file/d/1vkkZrG2BCWkd3urKMoALjZFzAcWMyK2T/view";

pdfToText(link, process.env.PDF_PASSWORD)
    .then(text => console.log(text))
    .catch(error => {
        console.error(`${error.code ?? error.name}: ${error.message}`);
        process.exitCode = 1;
    });
