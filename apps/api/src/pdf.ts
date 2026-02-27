import PDFDocument from "pdfkit";

export const renderTextToPDF = async (title: string, text: string) => {
  const doc = new PDFDocument({ margin: 50 });
  const chunks: Buffer[] = [];

  doc.on("data", (chunk) => chunks.push(chunk));

  doc.fontSize(18).text(title, { align: "left" });
  doc.moveDown();
  doc.fontSize(11).text(text || "", {
    align: "left",
  });

  doc.end();

  return await new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
};
