; Read-only CAD preflight inspector for AutoCAD Core Console. No drawing or application setting writes.
; Every line is kept under 200 characters so Core Console .scr reader never truncates long lines.
(defun cp-fail (s) (princ (strcat "\nCAD_PREFLIGHT_ERROR: " s)) (exit))
(defun cp-need (v s) (if (not v) (cp-fail s)) v)
(defun cp-hex4 (n / s)
  (setq s "")
  (repeat 4
    (setq s (strcat (substr "0123456789abcdef" (1+ (rem n 16)) 1) s)
          n (fix (/ n 16))))
  s)
(defun cp-quote (s / out n)
  (if (not (eq (type s) 'STR)) (setq s ""))
  (setq out "\"")
  (foreach n (vl-string->list s)
    (setq out
      (strcat out
        (cond
          ((= n 34) "\\\"")
          ((= n 92) "\\\\")
          ((= n 8) "\\b")
          ((= n 12) "\\f")
          ((= n 10) "\\n")
          ((= n 13) "\\r")
          ((= n 9) "\\t")
          ((or (< n 32) (> n 126))
           (if (> n 65535)
             (strcat "\\u" (cp-hex4 (+ 55296 (fix (/ (- n 65536) 1024))))
                     "\\u" (cp-hex4 (+ 56320 (rem (- n 65536) 1024))))
             (strcat "\\u" (cp-hex4 n))))
          (t (chr n))))))
  (strcat out "\""))
(defun cp-num (n / s)
  (if (or (not (numberp n)) (>= (abs n) 1e100))
    "null"
    (progn
      (setq s (rtos n 2 6))
      (if (< (abs n) 1.0)
        (progn
          (if (= (substr s 1 1) ".") (setq s (strcat "0" s)))
          (if (= (substr s 1 2) "-.") (setq s (strcat "-0" (substr s 2))))))
      (if (= (substr s (strlen s) 1) ".") (setq s (strcat s "0")))
      s)))
(defun cp-num4 (n / s)
  (if (or (not (numberp n)) (>= (abs n) 1e15))
    "null"
    (progn
      (setq s (rtos n 2 2))
      (if (< (abs n) 1.0)
        (progn
          (if (= (substr s 1 1) ".") (setq s (strcat "0" s)))
          (if (= (substr s 1 2) "-.") (setq s (strcat "-0" (substr s 2))))))
      s)))
(defun cp-pt (p)
  (if (and (listp p) (>= (length p) 2) (numberp (car p)) (numberp (cadr p))
           (< (abs (car p)) 1e15) (< (abs (cadr p)) 1e15))
    (strcat "[" (cp-num (car p)) "," (cp-num (cadr p)) ","
      (cp-num (if (and (>= (length p) 3) (numberp (caddr p)) (< (abs (caddr p)) 1e15))
                (caddr p) 0.0)) "]")
    "null"))
(defun cp-pt2 (p)
  (if (and (listp p) (>= (length p) 2) (numberp (car p)) (numberp (cadr p))
           (< (abs (car p)) 1e15) (< (abs (cadr p)) 1e15))
    (strcat "[" (cp-num4 (car p)) "," (cp-num4 (cadr p)) "]")
    "null"))
(defun cp-dxf (code d) (cdr (assoc code d)))
(defun cp-inc (key alist / pair)
  (setq pair (assoc key alist))
  (if pair
    (subst (cons key (1+ (cdr pair))) pair alist)
    (cons (cons key 1) alist)))
(defun cp-mtext (d / s item)
  (setq s "")
  (foreach item d
    (if (and (or (= (car item) 3) (= (car item) 1)) (eq (type (cdr item)) 'STR))
      (setq s (strcat s (cdr item)))))
  s)
(defun cp-write-map (f alist / sep pair)
  (princ "{" f)
  (setq sep "")
  (foreach pair alist
    (princ (strcat sep (cp-quote (car pair)) ":" (itoa (cdr pair))) f)
    (setq sep ","))
  (princ "}" f))
(defun cp-attribs (e / ae ad atype ac out sep tag val)
  (setq ae (entnext e) ac 0 out "[" sep "")
  (while (and ae (< ac 30))
    (setq ad (entget ae) atype (if ad (cp-dxf 0 ad) nil))
    (cond
      ((or (null ad) (= atype "SEQEND")) (setq ae nil))
      ((= atype "ATTRIB")
       (setq tag (cp-dxf 2 ad)
             val (cp-dxf 1 ad)
             out (strcat out sep "{\"tag\":" (cp-quote tag)
                         ",\"value\":" (cp-quote val)
                         ",\"p\":" (cp-pt2 (cp-dxf 10 ad)) "}")
             sep ","
             ac (1+ ac)
             ae (entnext ae)))
      (t (setq ae (entnext ae)))))
  (strcat out "]"))
(defun cp-layouts (/ dict item out)
  (setq dict (dictsearch (namedobjdict) "ACAD_LAYOUT") out nil)
  (foreach item dict
    (if (and (= (car item) 3) (/= (strcase (cdr item)) "MODEL"))
      (setq out (cons (cdr item) out))))
  (reverse out))
(defun cp-xform (pt bx by ix iy sx sy cs sn / lx ly)
  (if (and (listp pt) (>= (length pt) 2)
           (numberp (car pt)) (numberp (cadr pt)))
    (progn
      (setq lx (* (- (car pt) bx) sx)
            ly (* (- (cadr pt) by) sy))
      (list (+ ix (- (* lx cs) (* ly sn)))
            (+ iy (+ (* lx sn) (* ly cs)))))
    nil))
(defun cp-write-lwpoly (gf qh ql d bx by ix iy sx sy cs sn fbJson /
                        closedFlag item pts bulges curBulge hasBulge
                        p xp sep b)
  (setq closedFlag
    (if (= (logand (if (numberp (cp-dxf 70 d)) (cp-dxf 70 d) 0) 1) 1)
      "true" "false")
    pts nil bulges nil curBulge 0.0 hasBulge nil)
  (foreach item d
    (cond
      ((= (car item) 10)
       (if pts (setq bulges (cons curBulge bulges)))
       (setq curBulge 0.0
             p (cdr item)
             xp (if ix (cp-xform p bx by ix iy sx sy cs sn) p))
       (if xp (setq pts (cons xp pts))))
      ((= (car item) 42)
       (if (numberp (cdr item))
         (progn
           (setq curBulge (cdr item))
           (if (> (abs curBulge) 1e-6) (setq hasBulge T)))))))
  (if pts (setq bulges (cons curBulge bulges)))
  (setq pts (reverse pts) bulges (reverse bulges))
  (if (>= (length pts) 2)
    (progn
      (princ (strcat "{\"t\":\"LWPOLYLINE\",\"h\":" qh ",\"l\":" ql
                     ",\"c\":" closedFlag fbJson ",\"pts\":[") gf)
      (setq sep "")
      (foreach p pts
        (princ (strcat sep (cp-pt2 p)) gf)
        (setq sep ","))
      (if hasBulge
        (progn
          (princ "],\"b\":[" gf)
          (setq sep "")
          (foreach b bulges
            (princ (strcat sep (cp-num4 b)) gf)
            (setq sep ","))))
      (write-line "]}" gf)
      T)
    nil))
(defun cp-write-poly (gf qh ql e d bx by ix iy sx sy cs sn fbJson /
                      closedFlag ve vd vtyp vflg p xp pts bulges
                      bulge hasBulge sep b vc)
  (setq closedFlag
    (if (= (logand (if (numberp (cp-dxf 70 d)) (cp-dxf 70 d) 0) 1) 1)
      "true" "false")
    ve (entnext e) pts nil bulges nil hasBulge nil vc 0)
  (while (and ve (< vc 5000))
    (setq vd (entget ve) vtyp (if vd (cp-dxf 0 vd) nil))
    (cond
      ((or (null vd) (= vtyp "SEQEND")) (setq ve nil))
      ((= vtyp "VERTEX")
       (setq vflg (if (numberp (cp-dxf 70 vd)) (cp-dxf 70 vd) 0))
       (if (= (logand vflg 16) 0)
         (progn
           (setq p (cp-dxf 10 vd)
                 xp (if ix (cp-xform p bx by ix iy sx sy cs sn) p)
                 bulge (if (numberp (cp-dxf 42 vd)) (cp-dxf 42 vd) 0.0))
           (if xp
             (progn
               (setq pts (cons xp pts)
                     bulges (cons bulge bulges))
               (if (> (abs bulge) 1e-6) (setq hasBulge T))))))
       (setq vc (1+ vc) ve (entnext ve)))
      (t (setq ve (entnext ve)))))
  (setq pts (reverse pts) bulges (reverse bulges))
  (if (>= (length pts) 2)
    (progn
      (princ (strcat "{\"t\":\"POLYLINE\",\"h\":" qh ",\"l\":" ql
                     ",\"c\":" closedFlag fbJson ",\"pts\":[") gf)
      (setq sep "")
      (foreach p pts
        (princ (strcat sep (cp-pt2 p)) gf)
        (setq sep ","))
      (if hasBulge
        (progn
          (princ "],\"b\":[" gf)
          (setq sep "")
          (foreach b bulges
            (princ (strcat sep (cp-num4 b)) gf)
            (setq sep ","))))
      (write-line "]}" gf)
      T)
    nil))
(defun cp-expand-block (gf qh parentLayer bname qBname insPt sx sy rot
                        depth / bdef be bp bx by ix iy cs sn bd btyp
                        blay effLay qLay fbJson p1 p2 pc rr a1 a2
                        subName subQ subPt subSx subSy subRot
                        subIns subAng)
  (if (and gf (< depth 4) (< geomCount 80000)
           (listp insPt) (>= (length insPt) 2)
           (not (wcmatch (strcase bname) "`*D*,`*MODEL_SPACE,`*PAPER_SPACE*")))
    (progn
      (setq bdef (tblsearch "BLOCK" bname))
      (if bdef
        (progn
          (setq be (cp-dxf -2 bdef)
                bp (cp-dxf 10 bdef)
                bx (if (and (listp bp) (numberp (car bp))) (car bp) 0.0)
                by (if (and (listp bp) (numberp (cadr bp))) (cadr bp) 0.0)
                ix (car insPt) iy (cadr insPt)
                cs (cos rot) sn (sin rot)
                fbJson (strcat ",\"fb\":" qBname))
          (while (and be (< geomCount 80000))
            (if (= (logand geomCount 255) 0)
              (cp-need (< (- (getvar "MILLISECS") started) budgetMs)
                       "internal-time-budget-exceeded"))
            (setq bd (entget be))
            (if bd
              (progn
                (setq btyp (cp-dxf 0 bd)
                      blay (if (eq (type (cp-dxf 8 bd)) 'STR) (cp-dxf 8 bd) "0")
                      effLay (if (= blay "0") parentLayer blay)
                      qLay (cdr (assoc effLay layQuotes)))
                (if (not qLay)
                  (setq qLay (cp-quote effLay)
                        layQuotes (cons (cons effLay qLay) layQuotes)))
                (if (not (member (strcase effLay) '("REBAR" "REIN" "HATCH" "PUB_HATCH")))
                  (cond
                    ((= btyp "LINE")
                     (setq p1 (cp-xform (cp-dxf 10 bd) bx by ix iy sx sy cs sn)
                           p2 (cp-xform (cp-dxf 11 bd) bx by ix iy sx sy cs sn))
                     (if (and p1 p2)
                       (progn
                         (write-line (strcat "{\"t\":\"LINE\",\"h\":" qh
                           ",\"l\":" qLay fbJson ",\"p1\":" (cp-pt2 p1)
                           ",\"p2\":" (cp-pt2 p2) "}") gf)
                         (setq geomCount (1+ geomCount)))))
                    ((= btyp "LWPOLYLINE")
                     (if (cp-write-lwpoly gf qh qLay bd bx by ix iy sx sy cs sn fbJson)
                       (setq geomCount (1+ geomCount))))
                    ((= btyp "POLYLINE")
                     (if (cp-write-poly gf qh qLay be bd bx by ix iy sx sy cs sn fbJson)
                       (setq geomCount (1+ geomCount))))
                    ((= btyp "CIRCLE")
                     (setq pc (cp-xform (cp-dxf 10 bd) bx by ix iy sx sy cs sn)
                           rr (if (numberp (cp-dxf 40 bd))
                                (* (cp-dxf 40 bd) (max (abs sx) (abs sy))) nil))
                     (if (and pc rr)
                       (progn
                         (write-line (strcat "{\"t\":\"CIRCLE\",\"h\":" qh
                           ",\"l\":" qLay fbJson ",\"p\":" (cp-pt2 pc)
                           ",\"r\":" (cp-num4 rr) "}") gf)
                         (setq geomCount (1+ geomCount)))))
                    ((= btyp "ARC")
                     (setq pc (cp-xform (cp-dxf 10 bd) bx by ix iy sx sy cs sn)
                           rr (if (numberp (cp-dxf 40 bd))
                                (* (cp-dxf 40 bd) (max (abs sx) (abs sy))) nil)
                           a1 (if (numberp (cp-dxf 50 bd)) (+ (cp-dxf 50 bd) rot) 0.0)
                           a2 (if (numberp (cp-dxf 51 bd)) (+ (cp-dxf 51 bd) rot) 0.0))
                     (if (and pc rr)
                       (progn
                         (write-line (strcat "{\"t\":\"ARC\",\"h\":" qh
                           ",\"l\":" qLay fbJson ",\"p\":" (cp-pt2 pc)
                           ",\"r\":" (cp-num4 rr) ",\"a1\":" (cp-num4 a1)
                           ",\"a2\":" (cp-num4 a2) "}") gf)
                         (setq geomCount (1+ geomCount)))))
                    ((= btyp "INSERT")
                     (setq subName (cp-dxf 2 bd)
                           subPt (cp-dxf 10 bd)
                           subSx (if (numberp (cp-dxf 41 bd)) (cp-dxf 41 bd) 1.0)
                           subSy (if (numberp (cp-dxf 42 bd)) (cp-dxf 42 bd) 1.0)
                           subRot (if (numberp (cp-dxf 50 bd)) (cp-dxf 50 bd) 0.0)
                           subIns (cp-xform subPt bx by ix iy sx sy cs sn)
                           subAng (+ rot subRot))
                     (if (and (eq (type subName) 'STR) subIns)
                       (progn
                         (setq subQ (cp-quote subName))
                         (cp-expand-block gf qh effLay subName subQ subIns
                           (* sx subSx) (* sy subSy) subAng (1+ depth)))))))))
            (setq be (entnext be))))))))
(defun cp-main (/ out geomOut gf geomCount before started budgetStr budgetMs f
                  lay layCount laySep layouts layName layQuotes qLayer qh
                  ss ssn n e d typ h layer skipGeom
                  countsByType countsByLayer proxyCount lineCount polyCount
                  circleCount arcCount textCount dimCount blockCount otherCount
                  texts dims blocks textCap dimCap blockCap
                  textTrunc dimTrunc blockTrunc
                  psSs psN psIdx psE psD psTyp psCounts psTexts
                  psTextCount psTextTrunc ssAfter extMin extMax item
                  txtVal qTxt rot meas dimTxt qDimTxt p10 p13 p14
                  bname qBname sx sy sz attJson)
  (cp-need (member (getvar "LISPSYS") '(1 2))
           "unicode-engine-unavailable-no-setting-change")
  (cp-need (= (strcase (getvar "DWGNAME")) "SOURCE.DWG")
           "unexpected-dwg-name")
  (cp-need (= (strcase (getvar "DWGPREFIX"))
              (strcase (getenv "CAD_PREFLIGHT_INPUT_DIR")))
           "unexpected-dwg-directory")
  (setq out (getenv "CAD_PREFLIGHT_OUTPUT")
        geomOut (getenv "CAD_PREFLIGHT_GEOMETRY_OUTPUT")
        budgetStr (getenv "CAD_PREFLIGHT_BUDGET_MS")
        budgetMs (if (and budgetStr (> (atoi budgetStr) 0))
                   (atoi budgetStr) 240000)
        before (getvar "DBMOD")
        started (getvar "MILLISECS")
        gf nil
        geomCount 0)
  (cp-need (= before 0) "drawing-already-modified-on-open")
  (setq f (open out "w"))
  (cp-need f "cannot-open-json-output")
  (if (and geomOut (> (strlen geomOut) 0))
    (progn
      (setq gf (open geomOut "w"))
      (cp-need gf "cannot-open-geometry-jsonl-output")))
  (setq extMin (getvar "EXTMIN") extMax (getvar "EXTMAX"))
  (princ "{\"schemaVersion\":1,\"status\":\"cad-preflight-readonly\"," f)
  (princ "\"readOnlyRequested\":true,\"saveRequested\":false," f)
  (princ (strcat "\"dbmodBefore\":" (itoa before)
                 ",\"insunits\":" (itoa (getvar "INSUNITS"))
                 ",\"lunits\":" (itoa (getvar "LUNITS"))
                 ",\"measurement\":" (itoa (getvar "MEASUREMENT"))
                 ",\"lispsys\":" (itoa (getvar "LISPSYS"))
                 ",\"dwgCodePage\":" (cp-quote (getvar "DWGCODEPAGE"))
                 ",\"insbase\":" (cp-pt (getvar "INSBASE"))
                 ",\"extMin\":" (cp-pt extMin)
                 ",\"extMax\":" (cp-pt extMax) ",") f)
  (princ "\"layouts\":[\"Model\"" f)
  (setq layouts (cp-layouts))
  (foreach layName layouts (princ (strcat "," (cp-quote layName)) f))
  (princ "],\"layers\":[" f)
  (setq lay (tblnext "LAYER" T) layCount 0 laySep "" layQuotes nil)
  (while (and lay (< layCount 500))
    (setq layName (cp-dxf 2 lay)
          qLayer (cp-quote layName)
          layQuotes (cons (cons layName qLayer) layQuotes))
    (princ (strcat laySep "{\"name\":" qLayer
      ",\"flags\":" (itoa (if (cp-dxf 70 lay) (cp-dxf 70 lay) 0))
      ",\"color\":" (itoa (if (cp-dxf 62 lay) (cp-dxf 62 lay) 7))
      ",\"frozen\":" (if (= (logand (if (cp-dxf 70 lay) (cp-dxf 70 lay) 0) 1) 1)
                       "true" "false")
      ",\"locked\":" (if (= (logand (if (cp-dxf 70 lay) (cp-dxf 70 lay) 0) 4) 4)
                       "true" "false")
      ",\"off\":" (if (< (if (cp-dxf 62 lay) (cp-dxf 62 lay) 7) 0)
                    "true" "false") "}") f)
    (setq laySep "," layCount (1+ layCount) lay (tblnext "LAYER")))
  (princ (strcat "],\"layerCount\":" (itoa layCount)
                 ",\"layersTruncated\":" (if lay "true" "false") ",") f)
  (setq ss (ssget "_X" '((410 . "Model"))) ssn (if ss (sslength ss) 0))
  (cp-need (<= ssn 200000) "excessive-Model-graphical-selection")
  (setq n 0 countsByType nil countsByLayer nil proxyCount 0
        lineCount 0 polyCount 0 circleCount 0 arcCount 0
        textCount 0 dimCount 0 blockCount 0 otherCount 0)
  (setq texts nil dims nil blocks nil
        textCap 2000 dimCap 1500 blockCap 1500
        textTrunc nil dimTrunc nil blockTrunc nil)
  (while (< n ssn)
    (if (= (logand n 255) 0)
      (cp-need (< (- (getvar "MILLISECS") started) budgetMs)
               "internal-time-budget-exceeded"))
    (setq e (ssname ss n) d (if e (entget e) nil))
    (if (not d)
      (setq proxyCount (1+ proxyCount)
            countsByType (cp-inc "UNREADABLE_ENTITY" countsByType))
      (progn
        (setq typ (cp-dxf 0 d)
              h (if (eq (type (cp-dxf 5 d)) 'STR) (strcase (cp-dxf 5 d)) "")
              qh (strcat "\"" h "\"")
              layer (if (eq (type (cp-dxf 8 d)) 'STR) (cp-dxf 8 d) "0")
              qLayer (cdr (assoc layer layQuotes)))
        (if (not qLayer)
          (setq qLayer (cp-quote layer)
                layQuotes (cons (cons layer qLayer) layQuotes)))
        (setq skipGeom (member (strcase layer) '("REBAR" "REIN" "HATCH" "PUB_HATCH"))
              countsByType (cp-inc typ countsByType)
              countsByLayer (cp-inc layer countsByLayer))
        (cond
          ((= typ "LINE")
           (setq lineCount (1+ lineCount))
           (if (and gf (not skipGeom))
             (progn
               (write-line (strcat "{\"t\":\"LINE\",\"h\":" qh ",\"l\":" qLayer
                 ",\"p1\":" (cp-pt2 (cp-dxf 10 d))
                 ",\"p2\":" (cp-pt2 (cp-dxf 11 d)) "}") gf)
               (setq geomCount (1+ geomCount)))))
          ((= typ "LWPOLYLINE")
           (setq polyCount (1+ polyCount))
           (if (and gf (not skipGeom))
             (if (cp-write-lwpoly gf qh qLayer d 0.0 0.0 nil nil 1.0 1.0 1.0 0.0 "")
               (setq geomCount (1+ geomCount)))))
          ((= typ "POLYLINE")
           (setq polyCount (1+ polyCount))
           (if (and gf (not skipGeom))
             (if (cp-write-poly gf qh qLayer e d 0.0 0.0 nil nil 1.0 1.0 1.0 0.0 "")
               (setq geomCount (1+ geomCount)))))
          ((= typ "CIRCLE")
           (setq circleCount (1+ circleCount))
           (if (and gf (not skipGeom))
             (progn
               (write-line (strcat "{\"t\":\"CIRCLE\",\"h\":" qh ",\"l\":" qLayer
                 ",\"p\":" (cp-pt2 (cp-dxf 10 d))
                 ",\"r\":" (cp-num4 (cp-dxf 40 d)) "}") gf)
               (setq geomCount (1+ geomCount)))))
          ((= typ "ARC")
           (setq arcCount (1+ arcCount))
           (if (and gf (not skipGeom))
             (progn
               (write-line (strcat "{\"t\":\"ARC\",\"h\":" qh ",\"l\":" qLayer
                 ",\"p\":" (cp-pt2 (cp-dxf 10 d))
                 ",\"r\":" (cp-num4 (cp-dxf 40 d))
                 ",\"a1\":" (cp-num4 (cp-dxf 50 d))
                 ",\"a2\":" (cp-num4 (cp-dxf 51 d)) "}") gf)
               (setq geomCount (1+ geomCount)))))
          ((= typ "ACAD_PROXY_ENTITY")
           (setq proxyCount (1+ proxyCount)))
          ((or (= typ "TEXT") (= typ "MTEXT"))
           (setq textCount (1+ textCount)
                 txtVal (if (= typ "MTEXT") (cp-mtext d) (cp-dxf 1 d))
                 qTxt (cp-quote txtVal)
                 rot (if (cp-dxf 50 d) (cp-dxf 50 d) 0.0))
           (if (<= textCount textCap)
             (setq texts (cons (strcat "{\"handle\":" qh
               ",\"type\":" (cp-quote typ)
               ",\"layer\":" qLayer
               ",\"text\":" qTxt
               ",\"point\":" (cp-pt (cp-dxf 10 d))
               ",\"height\":" (cp-num (cp-dxf 40 d)) "}") texts))
             (setq textTrunc T))
           (if (and gf (not skipGeom))
             (progn
               (write-line (strcat "{\"t\":" (cp-quote typ) ",\"h\":" qh
                 ",\"l\":" qLayer ",\"v\":" qTxt
                 ",\"p\":" (cp-pt2 (cp-dxf 10 d))
                 ",\"ht\":" (cp-num4 (cp-dxf 40 d))
                 ",\"r\":" (cp-num4 rot) "}") gf)
               (setq geomCount (1+ geomCount)))))
          ((= typ "DIMENSION")
           (setq dimCount (1+ dimCount)
                 dimTxt (if (cp-dxf 1 d) (cp-dxf 1 d) "")
                 qDimTxt (cp-quote dimTxt)
                 meas (cp-dxf 42 d)
                 rot (if (cp-dxf 50 d) (cp-dxf 50 d) 0.0)
                 p10 (cp-pt2 (cp-dxf 10 d))
                 p13 (cp-pt2 (cp-dxf 13 d))
                 p14 (cp-pt2 (cp-dxf 14 d)))
           (if (<= dimCount dimCap)
             (setq dims (cons (strcat "{\"handle\":" qh
               ",\"layer\":" qLayer
               ",\"textOverride\":" qDimTxt
               ",\"measurement\":" (cp-num meas)
               ",\"dimStyle\":" (cp-quote (cp-dxf 3 d))
               ",\"dimType\":" (itoa (if (cp-dxf 70 d) (cp-dxf 70 d) 0))
               ",\"p10\":" p10
               ",\"p13\":" p13
               ",\"p14\":" p14 "}") dims))
             (setq dimTrunc T))
           (if (and gf (not skipGeom))
             (progn
               (write-line (strcat "{\"t\":\"DIM\",\"h\":" qh ",\"l\":" qLayer
                 ",\"v\":" qDimTxt ",\"m\":" (cp-num4 meas)
                 ",\"p10\":" p10
                 ",\"p13\":" p13
                 ",\"p14\":" p14
                 ",\"r\":" (cp-num4 rot) "}") gf)
               (setq geomCount (1+ geomCount)))))
          ((= typ "INSERT")
           (setq blockCount (1+ blockCount)
                 bname (cp-dxf 2 d)
                 qBname (cp-quote bname)
                 sx (cp-dxf 41 d)
                 sy (cp-dxf 42 d)
                 sz (cp-dxf 43 d)
                 rot (if (cp-dxf 50 d) (cp-dxf 50 d) 0.0)
                 attJson nil)
           (if (<= blockCount blockCap)
             (progn
               (setq attJson (if (= (cp-dxf 66 d) 1) (cp-attribs e) "[]"))
               (setq blocks (cons (strcat "{\"handle\":" qh
                 ",\"layer\":" qLayer
                 ",\"blockName\":" qBname
                 ",\"point\":" (cp-pt (cp-dxf 10 d))
                 ",\"scale\":[" (cp-num (if sx sx 1.0)) ","
                                (cp-num (if sy sy 1.0)) ","
                                (cp-num (if sz sz 1.0)) "]"
                 ",\"rotation\":" (cp-num rot)
                 ",\"attributes\":" attJson "}") blocks)))
             (setq blockTrunc T))
           (if (and gf (not skipGeom))
             (progn
               (if (not attJson)
                 (setq attJson (if (= (cp-dxf 66 d) 1) (cp-attribs e) "[]")))
               (write-line (strcat "{\"t\":\"INSERT\",\"h\":" qh ",\"l\":" qLayer
                 ",\"b\":" qBname ",\"p\":" (cp-pt2 (cp-dxf 10 d))
                 ",\"s\":[" (cp-num4 (if sx sx 1.0)) ","
                            (cp-num4 (if sy sy 1.0)) "]"
                 ",\"r\":" (cp-num4 rot)
                 ",\"a\":" attJson "}") gf)
               (setq geomCount (1+ geomCount))
               (if (eq (type bname) 'STR)
                 (cp-expand-block gf qh layer bname qBname (cp-dxf 10 d)
                   (if sx sx 1.0) (if sy sy 1.0) rot 0)))))
          (t (setq otherCount (1+ otherCount))))))
    (setq n (1+ n)))
  (if gf (progn (close gf) (setq gf nil)))
  (setq ssAfter (ssget "_X" '((410 . "Model"))))
  (cp-need (= (if ssAfter (sslength ssAfter) 0) ssn)
           "selected-Model-count-changed")
  (setq psSs (ssget "_X" '((67 . 1)))
        psN (if psSs (sslength psSs) 0)
        psIdx 0 psCounts nil psTexts nil psTextCount 0 psTextTrunc nil)
  (while (and (< psIdx psN) (< psIdx 10000))
    (setq psE (ssname psSs psIdx) psD (if psE (entget psE) nil))
    (if psD (progn
      (setq psTyp (cp-dxf 0 psD)
            psCounts (cp-inc psTyp psCounts))
      (if (or (= psTyp "TEXT") (= psTyp "MTEXT"))
        (progn
          (setq psTextCount (1+ psTextCount))
          (if (<= psTextCount 500)
            (setq psTexts (cons (strcat "{\"type\":" (cp-quote psTyp)
              ",\"layer\":" (cp-quote (cp-dxf 8 psD))
              ",\"layout\":" (cp-quote (cp-dxf 410 psD))
              ",\"text\":" (cp-quote (if (= psTyp "MTEXT")
                                       (cp-mtext psD) (cp-dxf 1 psD)))
              ",\"point\":" (cp-pt (cp-dxf 10 psD)) "}") psTexts))
            (setq psTextTrunc T))))))
    (setq psIdx (1+ psIdx)))
  (cp-need (= before (getvar "DBMOD")) "drawing-modified-during-extraction")
  (princ (strcat "\"dbmodAfter\":" (itoa (getvar "DBMOD"))
                 ",\"modelSpaceEntityCount\":" (itoa ssn)
                 ",\"paperSpaceEntityCount\":" (itoa psN)
                 ",\"proxyEntityCount\":" (itoa proxyCount)
                 ",\"geometryJsonlCount\":" (itoa geomCount) ",") f)
  (princ (strcat "\"geometrySummary\":{\"line\":" (itoa lineCount)
                 ",\"polyline\":" (itoa polyCount)
                 ",\"circle\":" (itoa circleCount)
                 ",\"arc\":" (itoa arcCount)
                 ",\"text\":" (itoa textCount)
                 ",\"dimension\":" (itoa dimCount)
                 ",\"insert\":" (itoa blockCount)
                 ",\"proxy\":" (itoa proxyCount)
                 ",\"other\":" (itoa otherCount) "},") f)
  (princ "\"countsByType\":" f) (cp-write-map f countsByType)
  (princ ",\"countsByLayer\":" f) (cp-write-map f countsByLayer)
  (princ ",\"paperSpaceCountsByType\":" f) (cp-write-map f psCounts)
  (princ (strcat ",\"textsTruncated\":" (if textTrunc "true" "false")
                 ",\"texts\":[") f)
  (setq laySep "")
  (foreach item (reverse texts)
    (princ (strcat laySep item) f)
    (setq laySep ","))
  (princ (strcat "],\"dimensionsTruncated\":" (if dimTrunc "true" "false")
                 ",\"dimensions\":[") f)
  (setq laySep "")
  (foreach item (reverse dims)
    (princ (strcat laySep item) f)
    (setq laySep ","))
  (princ (strcat "],\"blocksTruncated\":" (if blockTrunc "true" "false")
                 ",\"blocks\":[") f)
  (setq laySep "")
  (foreach item (reverse blocks)
    (princ (strcat laySep item) f)
    (setq laySep ","))
  (princ (strcat "],\"paperSpaceTextsTruncated\":"
                 (if psTextTrunc "true" "false")
                 ",\"paperSpaceTexts\":[") f)
  (setq laySep "")
  (foreach item (reverse psTexts)
    (princ (strcat laySep item) f)
    (setq laySep ","))
  (princ "]}" f)
  (close f)
  (princ (strcat "\nCAD_PREFLIGHT_SUCCESS modelSpace=" (itoa ssn)
                 " paperSpace=" (itoa psN)
                 " texts=" (itoa textCount)
                 " dims=" (itoa dimCount)
                 " blocks=" (itoa blockCount)
                 " proxies=" (itoa proxyCount)
                 " geom=" (itoa geomCount)))
  T)
(setq cp-result (vl-catch-all-apply 'cp-main nil))
(if (vl-catch-all-error-p cp-result)
  (princ (strcat "\nCAD_PREFLIGHT_FAILED: "
                 (vl-catch-all-error-message cp-result))))
(princ)
