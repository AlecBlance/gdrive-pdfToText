# 📄 gdrive-pdfToText

A node module to extract texts from a PDF in Google Drive. It doesn't require Google Drive API, and it extracts even if "Viewers can't download, print and copy".

## Usage/Examples

Install

```bash
npm i gdrive-pdftotext
```

```javascript
import gdrivePdf from "gdrive-pdftotext";

const test = async () => {
  const driveUrl =
    "https://drive.google.com/file/d/1pGOAwzneiFqjRYOLvrXaR10U6sffQSCn/view?usp=sharing";
  const text = await gdrivePdf.pdfToText(driveUrl);
  //           await gdrivePdf.pdfToText(driveUrl, "password")
  console.log("🎃 Drive Url: ", driveUrl);
  console.log("🎉 Extracted Text:", text);
};

test();
```

## Test

Clone the project

```bash
  git clone https://github.com/AlecBlance/gdrive-pdfToText
```

Go to the project directory

```bash
  cd gdrive-pdfToText
```

Install dependencies

```bash
  npm install
```

Start the test

```bash
  npm run dev-sample
```

## FAQ

#### How does it work?

Well, it's simple. 🙌 Every pdf in google drive are being processed in `/presspage` endpoint which makes texts in pdf interactive. We just need to pass a certain `id` to get the texts, which can be found in the request sent to `/meta` endpoint.

#### Can it open pdf that cannot be downloaded/copied/printed?

It can! 🎉 As long as it can be viewed publicly. That's the good thing about this module, because it doesn't rely on Google Drive's API to restrict any process like retrieving information.

#### Why did you make this module?

My future project relies on this text extraction feature. Google Drive won't allow me to download nor extract texts from pdfs that are only available for viewing. Even, Google Apps Script is also restrictive. Just to make my future project possible, I should overcome this hurdle. 💪😆

#### Are you open to suggestions?

Well, of course! 😎 Feel free to contact me or do a PR. I'll review it and if it is good and valuable, I'll merge it right away.

## Tech Stack

**Client:** NodeJS

**Library:** fetch-retry (for timeout errors)

## Authors

- [@AlecBlance](https://www.github.com/AlecBlance)

## License

[MIT](LICENSE)
