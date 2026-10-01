const spreadsheetMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const docxMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const pdfMimeType = 'application/pdf'
const textPdfExtensions = new Set(['txt', 'md', 'csv', 'json', 'html', 'htm', 'xml'])
let pdfjsPromise

async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjsLib, workerUrl]) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl.default
      return pdfjsLib
    })
  }
  return pdfjsPromise
}

function extensionOf(fileName) {
  return fileName.split('.').pop()?.toLowerCase() || ''
}

function baseNameOf(fileName) {
  return fileName.replace(/\.[^.]+$/, '') || 'converted-file'
}

function isPdf(file) {
  return file.type === pdfMimeType || extensionOf(file.name) === 'pdf'
}

function isImage(file) {
  return file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(extensionOf(file.name))
}

function blobResult(blob, fileName) {
  return { blob, fileName }
}

async function pdfToDocx(file) {
  const pdfjsLib = await loadPdfJs()
  const { Document, Packer, Paragraph } = await import('docx')
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const paragraphs = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    let pageText = ''

    for (const item of content.items) {
      if (!('str' in item)) continue
      pageText += item.str
      pageText += item.hasEOL ? '\n' : ' '
    }

    if (pageNumber > 1) paragraphs.push(new Paragraph(''))
    paragraphs.push(...pageText.split(/\n+/).map((line) => new Paragraph(line.trim())))
  }

  const document = new Document({ sections: [{ children: paragraphs }] })
  const blob = await Packer.toBlob(document)
  return blobResult(blob, `${baseNameOf(file.name)}.docx`)
}

async function docxToXlsx(file) {
  const mammoth = (await import('mammoth/mammoth.browser')).default
  const XLSX = await import('@e965/xlsx')
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const rows = [...parsed.querySelectorAll('table tr')].map((row) =>
    [...row.querySelectorAll('th, td')].map((cell) => cell.textContent.trim()),
  )

  if (rows.length === 0) {
    const paragraphs = [...parsed.querySelectorAll('p, li')]
      .map((node) => node.textContent.trim())
      .filter(Boolean)
    rows.push(['Content'], ...(paragraphs.length ? paragraphs.map((line) => [line]) : [['No readable content found.']]))
  }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Converted')
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
  return blobResult(new Blob([bytes], { type: spreadsheetMimeType }), `${baseNameOf(file.name)}.xlsx`)
}

async function imageToPdf(file) {
  const { PDFDocument } = await import('pdf-lib')
  const bitmap = await createImageBitmap(file)
  const pdf = await PDFDocument.create()
  let image

  if (file.type === 'image/png' || extensionOf(file.name) === 'png') {
    image = await pdf.embedPng(await file.arrayBuffer())
  } else if (file.type === 'image/jpeg' || ['jpg', 'jpeg'].includes(extensionOf(file.name))) {
    image = await pdf.embedJpg(await file.arrayBuffer())
  } else {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d').drawImage(bitmap, 0, 0)
    const pngBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not prepare the image.')), 'image/png')
    })
    image = await pdf.embedPng(await pngBlob.arrayBuffer())
  }

  bitmap.close()
  const maxWidth = 547
  const maxHeight = 794
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height)
  const width = image.width * scale
  const height = image.height * scale
  const page = pdf.addPage([width + 48, height + 48])
  page.drawImage(image, { x: 24, y: 24, width, height })
  const bytes = await pdf.save()
  return blobResult(new Blob([bytes], { type: pdfMimeType }), `${baseNameOf(file.name)}.pdf`)
}

async function pdfToJpg(file) {
  const pdfjsLib = await loadPdfJs()
  const JSZip = (await import('jszip')).default
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const zip = new JSZip()
  const baseName = baseNameOf(file.name)

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1.5 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d')
    await page.render({ canvasContext: context, viewport }).promise
    const image = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not render a PDF page.')), 'image/jpeg', 0.92)
    })
    zip.file(`${baseName}-page-${pageNumber}.jpg`, image)
    canvas.width = 0
    canvas.height = 0
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  return blobResult(blob, `${baseName}-jpg-pages.zip`)
}

async function textToPdf(text, fileName) {
  const { PDFDocument, StandardFonts } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontSize = 10
  const lineHeight = 14
  const margin = 42
  const pageWidth = 595
  const pageHeight = 842
  const maxWidth = pageWidth - margin * 2
  const safeText = text.replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?')
  const lines = []

  for (const paragraph of safeText.split(/\r?\n/)) {
    let line = ''
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word
      if (line && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
        lines.push(line)
        line = word
      } else {
        line = candidate
      }
    }
    lines.push(line)
  }

  let page = pdf.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin
  for (const line of lines) {
    if (y < margin) {
      page = pdf.addPage([pageWidth, pageHeight])
      y = pageHeight - margin
    }
    page.drawText(line, { x: margin, y, size: fontSize, font, maxWidth })
    y -= lineHeight
  }

  const bytes = await pdf.save()
  return blobResult(new Blob([bytes], { type: pdfMimeType }), `${baseNameOf(fileName)}.pdf`)
}

async function anyFileToPdf(file) {
  if (isPdf(file)) {
    return blobResult(new Blob([await file.arrayBuffer()], { type: pdfMimeType }), `${baseNameOf(file.name)}.pdf`)
  }
  if (isImage(file)) return imageToPdf(file)

  const extension = extensionOf(file.name)
  if (extension === 'docx') {
    const mammoth = (await import('mammoth/mammoth.browser')).default
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return textToPdf(value, file.name)
  }
  if (textPdfExtensions.has(extension) || file.type.startsWith('text/')) {
    const text = await file.text()
    const printableText = ['html', 'htm', 'xml'].includes(extension)
      ? new DOMParser().parseFromString(text, 'text/html').body.textContent
      : text
    return textToPdf(printableText || '', file.name)
  }

  throw new Error('This file type is not supported for PDF conversion. Choose a PDF, DOCX, image, or text-based file.')
}

export async function convertFile(file, format) {
  if (!file) throw new Error('Choose a file to convert first.')

  const extension = extensionOf(file.name)
  if (format === 'PDF to Word') {
    if (!isPdf(file)) throw new Error('Choose a PDF file for PDF to Word conversion.')
    return pdfToDocx(file)
  }
  if (format === 'Word to Excel') {
    if (extension !== 'docx') throw new Error('Choose a DOCX file for Word to Excel conversion.')
    return docxToXlsx(file)
  }
  if (format === 'PDF to JPG') {
    if (!isPdf(file)) throw new Error('Choose a PDF file for PDF to JPG conversion.')
    return pdfToJpg(file)
  }
  if (format === 'Image to PDF') {
    if (!isImage(file)) throw new Error('Choose an image file for Image to PDF conversion.')
    return imageToPdf(file)
  }
  if (format === 'Any File to PDF') return anyFileToPdf(file)

  throw new Error('Choose a supported conversion format.')
}
