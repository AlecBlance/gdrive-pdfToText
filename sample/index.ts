import gdrivePdfToText from "../index";

const test = async () => {
  const driveUrl =
    "https://drive.google.com/file/d/1pGOAwzneiFqjRYOLvrXaR10U6sffQSCn/view?usp=sharing";
  const text = await gdrivePdfToText.pdfToText(driveUrl);
  console.log("🎃 Drive Url: ", driveUrl);
  console.log("🎉 Extracted Text:", text);
};

test();
