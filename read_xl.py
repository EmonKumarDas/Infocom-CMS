import pandas as pd

try:
    df = pd.read_excel(r'C:\Users\Admin\Downloads\Infocom-CMS\Copy of 1-CT All Conveyance Bill.xlsx', header=None)
    print("=== EXCEL FILE DATA PEEK ===")
    print(df.head(10).to_string())
except Exception as e:
    print("Error reading file:", e)
