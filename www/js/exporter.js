/* ============================================================================
 * exporter.js  —  내보내기 모듈 (ExportModule)
 * ----------------------------------------------------------------------------
 * [통합 대비 설계]
 *  - "정리 결과를 파일로 저장/공유하는 일"만 담당하는 독립 모듈.
 *  - 입력 형식(고정):  data = {
 *        transcript: string,               // 원문 전사
 *        summary: string[], todos: string[],
 *        decisions: string[], keywords: {word,count}[]
 *    }
 *  - 공개 함수:  saveMarkdown / saveDocx / savePdf / savePptx  (모두 async)
 *  - 저장 방식:  가능하면 Web Share(폰에서 카톡·메일 등으로 공유),
 *                안 되면 일반 다운로드로 자동 폴백.
 *  - 외부 라이브러리는 CDN에서 필요할 때만 불러오며,
 *    실패 시 한국어로 안내(조용히 실패 금지).
 * ==========================================================================*/

(function (global) {
  'use strict';

  // 라이브러리 CDN (필요할 때만 로드)
  const LIBS = {
    docx: 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js',       // window.docx
    pptx: 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js', // window.PptxGenJS
    // PDF: html2canvas 로 화면을 그려 이미지로 담는다 → 한글 폰트 임베드 없이도
    //      한글이 절대 안 깨지고, 폰에서 앱 없이 브라우저 PDF 뷰어로 바로 열린다.
    html2canvas: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
    jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js'
  };

  const _loaded = {};
  function loadScript(url) {
    if (_loaded[url]) return _loaded[url];
    _loaded[url] = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = function () { resolve(true); };
      s.onerror = function () {
        _loaded[url] = null; // 다음에 재시도 가능
        reject(new Error('스크립트 로드 실패: ' + url));
      };
      document.head.appendChild(s);
    });
    return _loaded[url];
  }

  /* --- 공통 유틸 --- */
  function today() {
    const d = new Date();
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function filename(ext) { return 'voice-memo-' + today() + '.' + ext; }

  function isEmpty(data) {
    return !data || (!(data.transcript || '').trim() &&
      !(data.summary || []).length && !(data.todos || []).length &&
      !(data.decisions || []).length);
  }

  // 파일 전달: 공유창(Web Share)을 쓰지 않고 "바로 다운로드"한다.
  //  - 폰에서 공유 시트가 뜨면 어디에 저장할지 헷갈린다는 교수님 피드백(2026-09-19).
  //  - 안드로이드 크롬은 a.download + blob URL 이면 Downloads 폴더에 저장된다.
  function deliver(blob, name, mime) {
    return new Promise(function (resolve, reject) {
      try {
        // 혹시 blob type 이 비어있으면 정확한 MIME 부여(확장자와 함께 인식 잘 되게)
        var out = (mime && (!blob.type)) ? new Blob([blob], { type: mime }) : blob;
        _download(out, name);
        resolve('downloaded');
      } catch (e) { reject(e); }
    });
  }
  function _download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 5000);
  }

  /* ======================= 1) Markdown ======================= */
  function buildMarkdown(data) {
    const list = function (arr) {
      return (arr && arr.length)
        ? arr.map(function (s) { return '- ' + s; }).join('\n')
        : '- (없음)';
    };
    var h1 = (data && data.title && String(data.title).trim()) ? String(data.title).trim() : '음성 메모 정리';
    let md = '# ' + h1 + '\n\n';
    md += '_작성일: ' + today() + '_\n\n';
    md += '## 📌 핵심 요약\n' + list(data.summary) + '\n\n';
    md += '## ✅ 할 일\n' + list(data.todos) + '\n\n';
    md += '## 📖 결정사항\n' + list(data.decisions) + '\n\n';
    if (data.keywords && data.keywords.length) {
      md += '## 🔑 자주 나온 단어\n';
      md += data.keywords.map(function (k) { return '- ' + k.word + ' (' + k.count + ')'; }).join('\n') + '\n\n';
    }
    md += '## 📝 전사 원문\n' + (data.transcript || '(없음)') + '\n';
    return md;
  }

  function saveMarkdown(data) {
    if (isEmpty(data)) return Promise.reject(new Error('내보낼 정리 결과가 없습니다.'));
    const blob = new Blob([buildMarkdown(data)], { type: 'text/markdown;charset=utf-8' });
    return deliver(blob, filename('md'), 'text/markdown');
  }

  /* ======================= 2) Word(.docx) ======================= */
  function saveDocx(data) {
    if (isEmpty(data)) return Promise.reject(new Error('내보낼 정리 결과가 없습니다.'));
    return loadScript(LIBS.docx).then(function () {
      const D = global.docx;
      if (!D) throw new Error('Word 라이브러리를 불러오지 못했습니다.');
      const FONT = 'Malgun Gothic'; // 맑은 고딕 (한글 안전)

      function h1(text) {
        return new D.Paragraph({
          spacing: { before: 240, after: 120 },
          children: [new D.TextRun({ text: text, bold: true, size: 32, font: FONT })]
        });
      }
      function bullets(arr) {
        if (!arr || !arr.length) {
          return [new D.Paragraph({ children: [new D.TextRun({ text: '(없음)', italics: true, size: 22, font: FONT })] })];
        }
        return arr.map(function (s) {
          return new D.Paragraph({
            bullet: { level: 0 },
            children: [new D.TextRun({ text: s, size: 22, font: FONT })]
          });
        });
      }
      function body(text) {
        return new D.Paragraph({ children: [new D.TextRun({ text: text, size: 22, font: FONT })] });
      }

      const children = [];
      children.push(new D.Paragraph({
        children: [new D.TextRun({ text: '음성 메모 정리', bold: true, size: 44, font: FONT })]
      }));
      children.push(body('작성일: ' + today()));
      children.push(h1('핵심 요약'));   children.push.apply(children, bullets(data.summary));
      children.push(h1('할 일'));       children.push.apply(children, bullets(data.todos));
      children.push(h1('결정사항'));    children.push.apply(children, bullets(data.decisions));
      if (data.keywords && data.keywords.length) {
        children.push(h1('자주 나온 단어'));
        children.push(body(data.keywords.map(function (k) { return k.word + '(' + k.count + ')'; }).join(', ')));
      }
      children.push(h1('전사 원문'));    children.push(body(data.transcript || '(없음)'));

      const doc = new D.Document({ sections: [{ children: children }] });
      return D.Packer.toBlob(doc).then(function (blob) {
        return deliver(blob, filename('docx'),
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      });
    });
  }

  /* ======================= 3) PPT(.pptx) — 초안 ======================= */
  function savePptx(data) {
    if (isEmpty(data)) return Promise.reject(new Error('내보낼 정리 결과가 없습니다.'));
    return loadScript(LIBS.pptx).then(function () {
      const Pptx = global.PptxGenJS;
      if (!Pptx) throw new Error('PPT 라이브러리를 불러오지 못했습니다.');
      const p = new Pptx();
      p.defineLayout({ name: 'A4', width: 10, height: 5.625 });
      p.layout = 'A4';
      const FONT = 'Malgun Gothic';
      const BLUE = '2563EB';

      // 표지
      let s = p.addSlide();
      s.background = { color: BLUE };
      s.addText('음성 메모 정리', { x: 0.5, y: 1.8, w: 9, h: 1, align: 'center',
        fontFace: FONT, fontSize: 40, bold: true, color: 'FFFFFF' });
      s.addText('작성일: ' + today() + '  ·  (초안)', { x: 0.5, y: 3.0, w: 9, h: 0.6,
        align: 'center', fontFace: FONT, fontSize: 16, color: 'DCE6FF' });

      function contentSlide(title, arr) {
        const sl = p.addSlide();
        sl.addText(title, { x: 0.5, y: 0.35, w: 9, h: 0.8, fontFace: FONT,
          fontSize: 26, bold: true, color: BLUE });
        const items = (arr && arr.length) ? arr : ['(없음)'];
        sl.addText(items.map(function (t) { return { text: t, options: { bullet: true } }; }),
          { x: 0.7, y: 1.3, w: 8.6, h: 3.8, fontFace: FONT, fontSize: 16, color: '222222',
            valign: 'top', lineSpacingMultiple: 1.2 });
      }
      contentSlide('📌 핵심 요약', data.summary);
      contentSlide('✅ 할 일', data.todos);
      contentSlide('📖 결정사항', data.decisions);

      return p.write('blob').then(function (blob) {
        return deliver(blob, filename('pptx'),
          'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      });
    });
  }

  /* ======================= 4) PDF (폰에서 바로 보기) ======================= */
  /* html2canvas 로 정리 내용을 그려 이미지로 PDF에 담는다.
   *  - 한글 폰트 임베드 없이도 한글이 절대 안 깨진다(브라우저 폰트로 렌더).
   *  - 폰에서 새 탭으로 열면 브라우저 PDF 뷰어가 바로 보여준다(앱 불필요).
   * @param win  클릭 시점에 미리 연 빈 탭(모바일 팝업차단 회피). 없으면 새로 연다.
   */
  function savePdf(data, win) {
    if (isEmpty(data)) return Promise.reject(new Error('내보낼 정리 결과가 없습니다.'));
    return Promise.all([loadScript(LIBS.html2canvas), loadScript(LIBS.jspdf)]).then(function () {
      var h2c = global.html2canvas;
      var jsPDFCtor = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
      if (!h2c || !jsPDFCtor) throw new Error('PDF 라이브러리를 불러오지 못했습니다.');

      var el = _buildPrintable(data);
      document.body.appendChild(el);
      return h2c(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, windowWidth: 720 })
        .then(function (canvas) {
          el.remove();
          var pdf = new jsPDFCtor({ unit: 'pt', format: 'a4' });
          var pw = pdf.internal.pageSize.getWidth();
          var ph = pdf.internal.pageSize.getHeight();
          var imgW = pw;
          var imgH = canvas.height * pw / canvas.width;
          var img = canvas.toDataURL('image/jpeg', 0.95);
          var heightLeft = imgH, position = 0;
          pdf.addImage(img, 'JPEG', 0, position, imgW, imgH);
          heightLeft -= ph;
          while (heightLeft > 0) {                 // 여러 장으로 나눠 담기
            position -= ph;
            pdf.addPage();
            pdf.addImage(img, 'JPEG', 0, position, imgW, imgH);
            heightLeft -= ph;
          }
          var url = pdf.output('bloburl');
          if (win && !win.closed) { try { win.location.href = url; return 'opened'; } catch (e) {} }
          var w2 = global.open(url, '_blank');
          if (w2) return 'opened';
          pdf.save(filename('pdf'));                // 팝업 차단 시 다운로드로 폴백
          return 'downloaded';
        }).catch(function (e) { el.remove(); throw e; });
    });
  }

  function _buildPrintable(data) {
    var esc2 = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var ul = function (arr) {
      if (!arr || !arr.length) return '<p style="color:#888;margin:4px 0">(없음)</p>';
      return '<ul style="margin:4px 0 10px;padding-left:20px">' +
        arr.map(function (s) { return '<li style="margin:4px 0">' + esc2(s) + '</li>'; }).join('') + '</ul>';
    };
    var title = (data.title && String(data.title).trim()) ? String(data.title).trim() : '음성 메모 정리';
    var div = document.createElement('div');
    div.style.cssText = 'position:absolute;left:-10000px;top:0;width:720px;padding:32px;' +
      'background:#fff;color:#111;font-family:\'Malgun Gothic\',\'Apple SD Gothic Neo\',sans-serif;font-size:16px;line-height:1.7;';
    var h = '<div style="font-size:24px;font-weight:800;color:#1d4ed8">' + esc2(title) + '</div>';
    h += '<div style="color:#666;margin:4px 0 16px;font-size:13px">작성일: ' + today() + '</div>';
    h += '<h2 style="font-size:18px;border-bottom:2px solid #2563eb;padding-bottom:4px;margin:14px 0 6px">핵심 요약</h2>' + ul(data.summary);
    h += '<h2 style="font-size:18px;border-bottom:2px solid #2563eb;padding-bottom:4px;margin:14px 0 6px">할 일</h2>' + ul(data.todos);
    h += '<h2 style="font-size:18px;border-bottom:2px solid #2563eb;padding-bottom:4px;margin:14px 0 6px">결정사항</h2>' + ul(data.decisions);
    h += '<h2 style="font-size:18px;border-bottom:2px solid #2563eb;padding-bottom:4px;margin:14px 0 6px">전사 원문</h2>';
    h += '<p style="white-space:pre-wrap;margin:4px 0">' + esc2(data.transcript || '(없음)') + '</p>';
    div.innerHTML = h;
    return div;
  }

  global.ExportModule = {
    buildMarkdown: buildMarkdown,   // MD 문자열(기록용). history 저장에 사용.
    filename: filename,
    saveMarkdown: saveMarkdown,     // MD 파일 저장(선택).
    saveDocx: saveDocx,
    savePptx: savePptx,
    savePdf: savePdf                // 폰에서 바로 보기(새 탭)
  };
})(window);
