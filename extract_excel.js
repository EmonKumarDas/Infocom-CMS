const xlsx = require("xlsx");
const fs = require("fs");
try {
  const workbook = xlsx.readFile("C:\\Users\\Admin\\Downloads\\Infocom-CMS\\Copy of 1-CT All Conveyance Bill.xlsx");
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
  fs.writeFileSync("C:\\Users\\Admin\\.gemini\\antigravity\\brain\\0bff3e99-64e2-46d1-bed5-79b762c1ef39\\excel_data.json", JSON.stringify(data.slice(0, 15), null, 2));
} catch (e) {
  fs.writeFileSync("C:\\Users\\Admin\\.gemini\\antigravity\\brain\\0bff3e99-64e2-46d1-bed5-79b762c1ef39\\excel_error.txt", e.message);
}
