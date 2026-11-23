; Read-only ModelSpace main-graphical inventory. No drawing or application setting writes.
; Every line is kept under 200 characters so Core Console .scr reader never truncates long lines.
(defun nr-fail (s) (princ (strcat "\nNATIVE_RO_ERROR: " s)) (exit))
(defun nr-need (v s) (if (not v) (nr-fail s)) v)
(defun nr-hex4 (n / s)
  (setq s "")
  (repeat 4
    (setq s (strcat (substr "0123456789abcdef" (1+ (rem n 16)) 1) s)
          n (fix (/ n 16))))
  s)
(defun nr-quote (s / out n)
  (setq out "\"")
  (foreach n (vl-string->list s)
    (setq out
      (strcat out
        (cond
          ((= n 34) "\\\"")
          ((= n 92) "\\\\")
          ((or (< n 32) (> n 126))
           (if (> n 65535)
             (strcat "\\u" (nr-hex4 (+ 55296 (fix (/ (- n 65536) 1024))))
                     "\\u" (nr-hex4 (+ 56320 (rem (- n 65536) 1024))))
             (strcat "\\u" (nr-hex4 n))))
          (t (chr n))))))
  (strcat out "\""))
(defun nr-num (n / s)
  (nr-need (and (numberp n) (< (abs n) 1e100)) "invalid-number")
  (setq s (rtos n 2 16))
  (if (= (substr s 1 1) ".") (setq s (strcat "0" s)))
  (if (= (substr s 1 2) "-.") (setq s (strcat "-0" (substr s 2))))
  (if (= (substr s (strlen s) 1) ".") (setq s (strcat s "0")))
  s)
(defun nr-point (p)
  (nr-need (= (length p) 3) "invalid-xyz")
  (strcat "[" (nr-num (car p)) "," (nr-num (cadr p)) "," (nr-num (caddr p)) "]"))
(defun nr-dxf (code d) (cdr (assoc code d)))
(defun nr-owner (d / depth item value owner)
  (setq depth 0 owner nil)
  (foreach item d
    (cond
      ((= (car item) 102)
       (setq value (cdr item))
       (cond
         ((= (substr value 1 1) "{") (setq depth (1+ depth)))
         ((= value "}")
          (setq depth (1- depth))
          (nr-need (>= depth 0) "unbalanced-102-owner-data"))))
      ((and (= (car item) 330) (= depth 0))
       (nr-need (null owner) "multiple-top-level-owner-pointers")
       (setq owner (cdr item)))))
  (nr-need (= depth 0) "unclosed-102-owner-data")
  (nr-need owner "missing-top-level-owner330")
  owner)
(defun nr-owner-data (d / od)
  (setq od (entget (nr-owner d)))
  (nr-need od "owner-entget-unavailable")
  (nr-need (= (nr-dxf 0 od) "BLOCK_RECORD") "owner-not-BLOCK_RECORD")
  (nr-need (= (nr-dxf 2 od) "*Model_Space") "owner-not-exact-Model_Space")
  (nr-need (nr-dxf 5 od) "owner-handle-missing")
  od)
(defun nr-model-evidence (d / p67)
  (setq p67 (assoc 67 d))
  (nr-need (or (null p67) (= (cdr p67) 0)) "entity-group67-not-model")
  (nr-need (= (nr-dxf 410 d) "Model") "entity-layout410-not-Model")
  T)
(defun nr-main (/ out before owner ownerData ownerHandle e d typ h layer
                  rows sep n lineCount unknownCount counts pair ss ssn
                  started result f handles ssAfter i afterHandles afterData)
  (nr-need (member (getvar "LISPSYS") '(1 2))
           "unicode-engine-unavailable-no-setting-change")
  (nr-need (= (strcase (getvar "DWGNAME")) "SOURCE.DWG") "unexpected-dwg-name")
  (nr-need (= (strcase (getvar "DWGPREFIX"))
              (strcase (getenv "NATIVE_RO_INPUT_DIR")))
           "unexpected-dwg-directory")
  (setq out (getenv "NATIVE_RO_OUTPUT")
        before (getvar "DBMOD")
        started (getvar "MILLISECS"))
  (nr-need (= before 0) "drawing-already-modified-on-open")
  (setq ss (ssget "_X" '((410 . "Model"))) ssn (if ss (sslength ss) 0))
  (nr-need (and (> ssn 0) (<= ssn 10000))
           "empty-or-excessive-Model-graphical-selection")
  (setq d (entget (ssname ss 0)))
  (nr-need d "first-selected-entity-unreadable")
  (nr-model-evidence d)
  (setq owner (nr-owner d)
        ownerData (nr-owner-data d)
        ownerHandle (nr-dxf 5 ownerData))
  (princ (strcat "\nNATIVE_RO_OWNER handle=" ownerHandle
                 " type=" (nr-dxf 0 ownerData)
                 " name=" (nr-dxf 2 ownerData)))
  (setq rows "" sep "" n 0 lineCount 0 unknownCount 0 counts nil handles nil)
  (while (< n ssn)
    (nr-need (< (- (getvar "MILLISECS") started) 45000)
             "internal-45-second-budget-exceeded")
    (setq e (ssname ss n)) (nr-need e "selected-ename-unavailable")
    (setq d (entget e)) (nr-need d "unreadable-entity")
    (nr-model-evidence d)
    (setq ownerData (nr-owner-data d))
    (nr-need (and (equal (nr-owner d) owner)
                  (= (nr-dxf 5 ownerData) ownerHandle))
             "selected-entity-owner-mismatch")
    (setq typ (nr-dxf 0 d))
    (nr-need (< n 10000) "entity-limit-exceeded")
    (setq h (nr-dxf 5 d) layer (nr-dxf 8 d))
    (nr-need (and h typ layer) "entity-metadata-missing")
    (setq h (strcase h))
    (nr-need (not (member h handles)) "duplicate-selected-handle")
    (setq handles (cons h handles))
    (setq n (1+ n) pair (assoc typ counts))
    (if pair
      (setq counts (subst (cons typ (1+ (cdr pair))) pair counts))
      (setq counts (cons (cons typ 1) counts)))
    (setq rows
      (strcat rows sep
        "{\"handle\":" (nr-quote h)
        ",\"type\":" (nr-quote typ)
        ",\"layer\":" (nr-quote layer)
        ",\"modelSpace\":true,\"owner330Handle\":" (nr-quote ownerHandle)
        ",\"ownerType\":\"BLOCK_RECORD\",\"ownerName\":\"*Model_Space\""
        ",\"group67Present\":" (if (assoc 67 d) "true" "false")
        ",\"group67Raw\":" (if (assoc 67 d) (itoa (nr-dxf 67 d)) "null")
        ",\"group67Effective\":0,\"layout410\":\"Model\""))
    (if (= typ "LINE")
      (progn
        (setq lineCount (1+ lineCount))
        (setq rows (strcat rows
          ",\"coordinateSpace\":\"native-world-xyz\""
          ",\"start\":" (nr-point (nr-dxf 10 d))
          ",\"end\":" (nr-point (nr-dxf 11 d)))))
      (progn
        (setq unknownCount (1+ unknownCount))
        (setq rows (strcat rows ",\"geometryUnknown\":true"))))
    (setq rows (strcat rows "}") sep ","))
  (setq ssAfter (ssget "_X" '((410 . "Model"))))
  (nr-need (and ssAfter (= ssn (sslength ssAfter)) (= n ssn))
           "selected-Model-count-changed")
  (setq i 0 afterHandles nil)
  (repeat ssn
    (setq afterData (entget (ssname ssAfter i)))
    (nr-need afterData "after-selection-entity-unavailable")
    (setq afterHandles (cons (strcase (nr-dxf 5 afterData)) afterHandles)
          i (1+ i)))
  (nr-need (equal (vl-sort handles '<) (vl-sort afterHandles '<))
           "selected-Model-handles-changed")
  (nr-need (= before (getvar "DBMOD")) "drawing-modified-during-extraction")
  (setq result
    (strcat
      "{\"schemaVersion\":2,\"status\":\"scoped-native-graphical-read\""
      ",\"scope\":\"selected-ModelSpace-main-graphical-entities\""
      ",\"readOnlyRequested\":true,\"saveRequested\":false"
      ",\"dbmodBefore\":" (itoa before)
      ",\"dbmodAfter\":" (itoa (getvar "DBMOD"))
      ",\"insunits\":" (itoa (getvar "INSUNITS"))
      ",\"insbase\":" (nr-point (getvar "INSBASE"))
      ",\"lispsys\":" (itoa (getvar "LISPSYS"))
      ",\"modelSpaceEntityCount\":" (itoa n)
      ",\"selectionCount\":" (itoa ssn)
      ",\"selectionCountAfter\":" (itoa (sslength ssAfter))
      ",\"selectionHandlesStable\":true"
      ",\"ownerRecordType\":\"BLOCK_RECORD\""
      ",\"ownerRecordName\":\"*Model_Space\""
      ",\"ownerRecordHandle\":" (nr-quote ownerHandle)
      ",\"lineGeometryCount\":" (itoa lineCount)
      ",\"unsupportedGeometryCount\":" (itoa unknownCount)
      ",\"selectedModelSpaceGraphicalInventoryComplete\":true"
      ",\"entireDatabaseInventoryComplete\":false"
      ",\"selectedLineGeometryComplete\":true"
      ",\"wholeDrawingDecodeAccepted\":false"
      ",\"designScaleVerified\":false"
      ",\"entities\":[" rows "],\"countsByType\":{"))
  (setq sep "")
  (foreach pair counts
    (setq result (strcat result sep (nr-quote (car pair)) ":" (itoa (cdr pair)))
          sep ","))
  (setq result
    (strcat result
      "},\"limitations\":["
      "\"ssget X/layout410=Model main graphical entities only; no entire-database claim. "
      "Attributes, polyline vertices, nested block definitions, paper space, "
      "erased/non-graphical objects and external xref contents are excluded.\","
      "\"INSERT/xref-reference main entities may be inventoried, "
      "but their referenced geometry is unknown.\","
      "\"Geometry is emitted only for LINE; all other geometry remains explicitly unknown.\","
      "\"INSUNITS is insertion scaling, not design calibration.\"]}"))
  (setq f (open out "w"))
  (nr-need f "cannot-open-json-output")
  (write-line result f)
  (close f)
  (princ (strcat "\nNATIVE_RO_SUCCESS modelSpace=" (itoa n)
                 " lines=" (itoa lineCount)
                 " unsupported=" (itoa unknownCount)))
  T)
(setq nr-result (vl-catch-all-apply 'nr-main nil))
(if (vl-catch-all-error-p nr-result)
  (princ (strcat "\nNATIVE_RO_FAILED: "
                 (vl-catch-all-error-message nr-result))))
(princ)
