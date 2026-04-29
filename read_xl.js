const xlsx = require("xlsx");

try {
  // Load the workbook
  const workbook = xlsx.readFile("C:\\Users\\Admin\\Downloads\\Infocom-CMS\\Copy of 1-CT All Conveyance Bill.xlsx");
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Convert to JSON
  const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
  
  console.log("=== EXCEL FILE DATA PEEK ===");
  data.slice(0, 10).forEach((row, i) => {
    console.log(`Row ${i + 1}:`, row);
  });
} catch (e) {
  console.error("Error reading file:", e.message);
}
