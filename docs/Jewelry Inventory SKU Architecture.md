# **Engineering an Automated Unique SKU Generation Architecture for Multi-Category Non-Precious and Fashion Jewellery**

## **The Taxonomy of Non-Precious Jewellery: Classification Challenges and Domain Dynamics**

The non-precious and imitation jewellery sector encompasses a highly volatile, fast-moving catalog environment characterized by aggressive design turnover, diverse artisanal manufacturing traditions, and concurrent wholesale and retail distribution models. Unlike precious metal jewelry, where valuation, cataloging, and inventory ledgers are anchored to verifiable commodity purities such as 22-karat gold or 925 sterling silver and certified gemstone carat weights, imitation jewellery utilizes non-precious substrates including brass, copper, zinc alloy, and German silver, embellished through diverse surface treatments and synthetic stones. The product taxonomy must simultaneously account for distinct regional aesthetics—such as South Indian Temple repoussé, Rajasthani Kundan and Polki foil settings, antique dull-gold patinas, and micro-plated daily wear—alongside contemporary Western and Indo-Western fashion jewelry lines.  
Attribute overlap and semantic ambiguity present recurring obstacles to effective cataloging within this market. In standard trade vernacular, descriptive terminology is frequently conflated; for example, an item may be colloquially designated as "Temple Jewellery," while simultaneously displaying a "matte finish" and utilizing "kundan-set" synthetic cabochons. If an inventory management platform constructs Stock Keeping Units (SKUs) directly from uncurated trade titles, duplicate codes, clashing classifications, and severe inventory cross-contamination inevitably emerge.  
Compounding this taxonomic complexity is the operational divergence between wholesale and retail transactions. Wholesale distributors routinely purchase and pick goods in bulk trade packaging—such as gross cartons, multi-unit cards, or dozen packs—whereas retail points of sale (POS) track and sell individual pieces. To prevent stock contamination across these channels, the software architecture must implement an orthogonal classification framework that strictly isolates core design categories from surface finish treatments, structural base alloys, stone palettes, and packaging metrics.

| Style Category | Characteristic Craft & Motifs | Dominant Plating / Surface Finish | Typical Gem / Embellishment Work | Primary Dimensional Variations |
| :---- | :---- | :---- | :---- | :---- |
| **Temple Jewellery** | Sacred iconography (Lakshmi, peacock, mango), coin repoussé (*kasumalai*) | Matte gold, antique dull polish, chemical oxidation | Kempu (synthetic red corundum), emerald-green glass, faux pearl drops | Choker inner circumference, haram drop length (24\\text{--}32\\text{ in}), bangle sizing (2.2\\text{--}2.10) |
| **Kundan & Jadau** | Foil-backed synthetic stone settings, reverse-side Meenakari enameling | High-luster yellow gold dip, antique yellow wash | Uncut glass polki, synthetic stones, multi-color bead drops | Collar width, bib drop depth, adjustable thread (*dori*) cordage |
| **Micro-Plated / Covering** | Machine-formed chains, daily-wear bangles, traditional thali cordage | 1-gram gold covering, 24K micro-electroplating (0.5\\text{--}1.0\\,\\mu\\text{m}) | Plain metal surface, channel-set synthetic zirconia accents | Chain length (16\\text{--}30\\text{ in}), link gauge width, bangle inner diameter |
| **Matte Finish** | Contemporary ethnic silhouettes, non-reflective warm brushed textures | Chemically muted matte gold, brushed rose gold | American Diamond (Cubic Zirconia), synthetic spinels, tone-on-tone enamel | Bangle diameter, finger ring shank gauge, stud face diameter |
| **Antique / Oxidized** | Vintage tribal filigree, rustic blackened ornamentation | Darkened chemical oxidation, dual-tone silver-black or brass-black | Reconstituted turquoise, black onyx glass, ghungroo bells | Bangle diameter, openable cuff clearance, anklet length (9.5\\text{--}11\\text{ in}) |
| **Western / Indo-Western** | Geometric linkages, tennis silhouettes, minimalist solitaires | Bright rhodium, anti-tarnish electro-coat, polished rose gold | Faceted cubic zirconia (AD), baguettes, crystal chatons | Ring sizes (6\\text{--}22), tennis bracelet length (6.5\\text{--}8.5\\text{ in}) |

## **Database Schema and Master Field Inventory: Structural Defense Against Cross-Contamination**

To guarantee that an automated SKU generation engine never produces duplicate or conflicting identifiers across hundreds of thousands of dynamic product records, master data must be segmented into normalized, mutually exclusive database entities. Cross-contamination occurs when secondary attributes are conflated with root categories—such as defining "Matte" as a primary product category rather than an applied finish, or embedding fluctuating wholesale packaging quantities directly into fixed design codes.  
An enterprise-grade schema organizes product properties across five distinct functional domains: Taxonomic Hierarchy, Metallurgical and Surface Properties, Embellishment and Colorway Configurations, Dimensional and Metric Variables, and Commercial and Fiscal Attributes. Each domain contains tightly controlled, standardized data dictionaries that prevent manual free-text input and enforce referential integrity throughout the inventory lifecycle.

| Attribute Domain | Field Name | Data Type & Length | Standard Master Values / Format Rules | Functional Role in Inventory & SKU Assembly |
| :---- | :---- | :---- | :---- | :---- |
| **Taxonomic Hierarchy** | category\_code | VARCHAR(3) | NEC (Necklaces), BAN (Bangles), EAR (Earrings), SET (Coordinated Sets), HAR (Harams), RIN (Rings), PAY (Anklets/Payal), MGT (Maang Tikka), HIP (Waist Belt) | Primary parent classification prefix |
|  | subcategory\_code | VARCHAR(3) | CHK (Choker), JHU (Jhumka), STU (Studs), CHA (Chain), KAD (Kada), BAL (Bali), MUG (Mugappu Chain) | Secondary morphology grouping |
|  | style\_genre\_code | VARCHAR(3) | TMP (Temple), KUN (Kundan), POL (Polki), ANT (Antique), COV (Covering), WST (Western), IND (Indo-Western) | Aesthetic design collection family |
|  | vendor\_source\_code | VARCHAR(3) | Standard 3-character supplier identifier or hub code (BOM, JPR, CHN, DEL, RAJ) | Sourcing traceability; isolates vendor style registries |
| **Metallurgical & Finish** | base\_metal\_code | VARCHAR(2) | BR (Brass), CP (Copper), ZA (Zinc Alloy / Zamak), GS (German Silver), IP (Impon / 5-Metal Alloy) | Base alloy identification and durability profiling |
|  | plating\_finish\_code | VARCHAR(2) | MG (Micro Gold Plated), MF (Matte Finish), AN (Antique Polish), OX (Oxidized), RH (Rhodium), RG (Rose Gold), TT (Two-Tone) | Child variant plating discriminator |
|  | plating\_durability | VARCHAR(3) | NOG (No Warranty), 06M (6-Month Warranty), 12M (1-Year Colour Guarantee) | Consumer warranty and billing validation |
| **Embellishment & Color** | stone\_type\_code | VARCHAR(2) | PL (Plain / No Stones), CZ (American Diamond), KP (Kempu Glass), KD (Foil Kundan), PR (Synthetic Pearl), GL (Faceted Glass) | Material composition classifier |
|  | primary\_color\_code | VARCHAR(2) | WH (White/Clear), RB (Ruby Red), EM (Emerald Green), ML (Multicolor), PK (Baby Pink), MN (Mint), BK (Black), BL (Blue) | Child variant visual discriminator |
|  | secondary\_color\_code | VARCHAR(2) | NA (None), PR (Pearl Drop), GR (Green Bead), RB (Ruby Bead) | Prevents dual-tone color collision |
| **Dimensional Metrics** | size\_code | VARCHAR(3) | Bangles: 202, 204, 206, 208, 210, 212; Rings: R08 to R22, ADJ; Chains: 16I, 18I, 24I, 30I; Generic: STD | Dimensional variant token |
|  | gross\_weight\_grams | DECIMAL(6,2) | Numeric mass in grams (0.01\\text{ to }999.99\\text{ g}) | Packaging verification and shipment audit |
| **Commercial & Fiscal** | unit\_of\_measure | VARCHAR(3) | PCS (Single Piece), PRS (Pair), SET (Ensemble), CRD (Card of 12), DOZ (Dozen), BOX (Prepack), GRS (Gross \- 144 pcs) | Transaction packaging determinant |
|  | hsn\_tax\_code | VARCHAR(8) | 71171910 (Bangles), 71171920 (German Silver), 71179010 (Studded Imitation), 71171100 (Cufflinks), 71179090 (Other) | Statutory GST rate routing (3% tax bracket) |

Dimensional variations in the South Asian non-precious jewellery sector require exact metric mapping, particularly for circular items such as bangles and openable kadas. Regional trade sizing derives from inner diameter measurements expressed in whole inches and fractions of sixteenths of an inch. The formula governing the inner diameter conversion illustrates the mathematical progression across standard sizes:  
\\text{Inner Diameter (Inches)} \= 2 \+ \\frac{S\_{\\text{fraction}}}{16}  
Converting these dimensions into metric values provides standard reference points for sizing:  
\\text{Size } 2\\text{-}2: 2 \+ \\frac{2}{16} \= 2.125\\text{ in} \\approx 53.98\\text{ mm} \\text{Size } 2\\text{-}4: 2 \+ \\frac{4}{16} \= 2.250\\text{ in} \\approx 57.15\\text{ mm} \\\\ \\text{Size } 2\\text{-}6: 2 \+ \\frac{6}{16} \= 2.375\\text{ in} \\approx 60.32\\text{ mm} \\\\ \\text{Size } 2\\text{-}8: 2 \+ \\frac{8}{16} \= 2.500\\text{ in} \\approx 63.50\\text{ mm} \\\\ \\text{Size } 2\\text{-}10: 2 \+ \\frac{10}{16} \= 2.625\\text{ in} \\approx 66.68\\text{ mm}  
Embedding these metrics into strict three-character alphanumeric strings (202, 204, 206, 208, 210\) prevents the formatting corruption and field delimitation errors commonly caused by hyphens, decimals, or mixed fraction notations.

## **Hybrid Hierarchical SKU Architecture: Decoupling Style Identity from Variant Execution**

A frequent point of structural failure in fashion and imitation jewellery ERP design is the implementation of fully meaningful, descriptive "smart" SKUs. When system architects attempt to embed every physical, metallurgical, and commercial parameter into a single human-readable string, the identifier expands rapidly beyond operational tolerance limits:  
\\text{String Length} \= \\sum\_{i=1}^{n} \\text{Length}(\\text{Segment}\_i\[span\_75\](start\_span)\[span\_75\](end\_span)\[span\_81\](start\_span)\[span\_81\](end\_span)) \+ (n \- 1\) \\times \\text{Length}(\\text{Delimiter})  
Concatenating style genre, product category, subcategory, base metal, plating finish, primary stone, accent stone, size, and packaging configuration yields a string that routinely exceeds 25 to 30 characters.  
This excessive length creates physical tagging bottlenecks and makes master data brittle. If an artisan alters an accent bead from pearl to green onyx, or substitutes a base alloy from brass to copper, a fully descriptive SKU must be systematically regenerated. Modifying primary keys breaks historical point-of-sale logs, inventory turnover calculations, and past purchase order references.  
To resolve this limitation, robust jewellery inventory platforms utilize a hybrid hierarchical architecture. This approach formally decouples the permanent **Parent Style SKU**—which anchors visual design, casting molds, and core photographic assets—from the transactable **Child Variant SKU**, which tracks physical variations across platings, stone colors, sizing, and packaging tiers.  
The Parent Style SKU is generated programmatically upon design registration, combining high-level classification tokens with an atomic, gapless database sequence:  
\\text{SKU}\_{\\text{Parent}} \= \\text{Genre}\_{3} \\mathbin{\\Vert} \\text{Category}\_{3} \\mathbin{\\Vert} \\text{Subcategory}\_{3} \\mathbin{\\Vert} \\text{ZeroPad}(\\text{Sequence}, 5\)  
Applying this formulation yields structured identifiers such as:  
\\text{TMP} \\mathbin{\\Vert} \\text{NEC} \\mathbin{\\Vert} \\text{CHK} \\mathbin{\\Vert} 04821 \\longrightarrow \\text{TMPNECCHK04821}  
This 14-character parent identifier serves as the central administrative key for the design archetype, supporting up to 100,000 discrete style models within that specific category and genre partition.  
The Child Variant SKU appends transactable operational properties to the parent core, using fixed-length segments separated by standard hyphens to ensure consistent parsing:  
\\text{SKU}\_{\\text{Child}} \= \\text{SKU}\_{\\text{Parent}} \\mathbin{\\Vert} \\text{"-"} \\mathbin{\\Vert} \\text{Plating}\_{2} \\mathbin{\\Vert} \\text{Color}\_{2} \\mathbin{\\Vert} \\text{Size}\_{3}  
This structure produces clean, human-readable variant codes:  
\\text{TMPNECCHK04821-MGRBSTD}  
This child SKU represents a Temple style choker (Style 04821\) manufactured in a micro-gold plated finish, set with ruby-red stones, and supplied in standard non-sized dimensions.  
In wholesale operations, managing bulk transactions requires supporting multi-pack handling without fracturing base inventory balances. Rather than creating entirely separate Parent SKUs for bulk product cards or gross cartons, the platform models commercial packaging tiers as relational extensions of the Child Variant SKU. The system applies standardized transaction suffixes that instruct the billing and inventory subroutines to decrement stock according to fixed multiplier rules.

| Commercial Packaging Tier | Applied Suffix | Transactable Wholesale / Retail SKU | Internal Multiplier | Operational Application & Inventory Routing |
| :---- | :---- | :---- | :---- | :---- |
| **Retail Individual Piece** | None / \-EA | TMPNECCHK04821-MGRBSTD | 1\\text{ Unit} | Standard point-of-sale retail scan; decrements single unit |
| **Wholesale Card (12 Pairs)** | \-C12 | TMPEARJHU01042-OXWHSTD-C12 | 12\\text{ Units} | B2B hanging display card; decrements 12 individual units from inventory |
| **Assorted Color Pack (6 Pcs)** | \-A06 | TMPEARSTU02105-MGASSTD-A06 | 6\\text{ Units} | Pre-packaged card of 6 mixed colorways; mapped to parent bill-of-materials |
| **Wholesale Bangle Box (6 Pcs)** | \-B06 | TMPBANKAD03112-MFML206-B06 | 6\\text{ Units} | Pre-boxed wholesale lot of identical size (2.6); decrements 6 units |
| **Wholesale Gross Master (144)** | \-G01 | WSTEARSTU08914-RHWHSTD-G01 | 144\\text{ Units} | Bulk manufacturer packaging; decrements 144 units; triggers tier-3 B2B pricing |

## **Barcode Symbologies, Physical Tagging, and Administrative Mode-Switching Architecture**

Physical tracking of non-precious jewellery occurs under strict geometric and optical constraints. The production media in use is a 14.3 \times 100\text{ mm} direct-thermal jewellery label supplied **3-up on a 45\text{ mm} web**. Each 100\text{ mm} feed pitch is a **64\text{ mm} body with a fold at 32\text{ mm}**, followed by a **36\text{ mm} narrow tail**. The body folds back-to-back into a **32 \times 14.3\text{ mm} two-sided tag**: one 32\text{ mm} face carries the symbology and human-readable SKU, the other carries the brand, SKU, MRP and HSN. The tail loops through the chain or earring post and adheres back onto the tag; it carries no print. The three lanes are pitched at 15\text{ mm} across the web (a 14.3\text{ mm} label plus die-cut gap), and the 100\text{ mm} dimension always runs through the printer feed. At the production resolution of 203\text{ dpi} (8 dots/mm) each 32\text{ mm} face is 256 \times 114 dots, enough for a Data Matrix symbol plus four human-readable lines.  
\+----------------+----------------+---+  
|  FACE 1        |  FACE 2        | T |  
|  32 x 14.3 mm  |  32 x 14.3 mm  | A |  
|  SKU/MRP/HSN   |  Code + SKU    | I |  
\+----------------+----------------+---+  
                  ^ fold at 32 mm  

The legacy 54 \times 11\text{ mm} two-wing dumbbell stock remains available in the label screen for inventory already tagged with it, but it is not the production stock.

### **Optical Physics of Mobile Camera and Handheld 2D Scanning on Micro Tags**

When selecting between 1D linear barcodes (Code 128\) and 2D matrix symbologies (Data Matrix ECC 200, QR Code), system designers must evaluate the optical mechanics of smartphone cameras and dedicated 2D imagers:

> 1. **Linear Barcode Horizontal Sprawl (Code 128\)**: In linear barcodes, each character requires a set number of modules. For Code 128, total width is W \= \[(11C \+ 35\) \+ 2Q\] \\times X\[span\_179\](start\_span)\[span\_179\](end\_span)\[span\_180\](start\_span)\[span\_180\](end\_span). Encoding a full 21-character Child SKU at a readable narrow-bar width (X \= 0.17\\text{ mm}) yields a physical width of 46.75\\text{ mm}\[span\_181\](start\_span)\[span\_181\](end\_span)\[span\_182\](start\_span)\[span\_182\](end\_span). That does not fit a 32\\text{ mm} face even on paper, and the 203\\text{ dpi} production printer cannot hold a 0.17\\text{ mm} module: at the minimum reliable two-dot module (0.25\\text{ mm}) the same code grows to roughly 66\\text{ mm}. Full alphanumeric 1D codes therefore do not fit either face. If 1D barcodes are used, the system must encode an abbreviated 8-digit numeric pointer ID (e.g., 90482101), which compacts down to 14.5\\text{ mm} via Code 128 Subset C.  
> 2. **2D Data Matrix ECC 200 (Compact Matrix)**: Data Matrix encodes data along both axes using an L-shaped finder pattern and requires only a 1-module quiet zone margin. It encodes a full 21-character alphanumeric SKU within a 14 \\times 14 or 16 \\times 16 grid, occupying a physical area of only 6 \\times 6\\text{ mm} to 7 \\times 7\\text{ mm} at 300\\text{ DPI}\[span\_188\](start\_span)\[span\_188\](end\_span)\[span\_190\](start\_span)\[span\_190\](end\_span). With built-in Reed-Solomon ECC 200 error correction, it decodes even if up to 30% of the symbol is obscured by polishing residue or surface scuffs.  
> 3. **2D QR Code (ISO/IEC 18004\)**: While QR codes are ubiquitous and scan natively via mobile operating system camera viewfinders without specialized decoder SDKs, they require three bulky corner position-detection squares and a 4-module quiet zone margin. For a 21-character string, a QR code requires a Version 2 (25 \\times 25\) or Version 3 (29 \\times 29\) grid, requiring a footprint of at least 9 \\times 9\\text{ mm} to 10 \\times 10\\text{ mm} to remain legible. On the 32 \\times 14.3\\text{ mm} face, a 9\\text{ mm} QR occupies most of the strip width but only about a quarter of the face length, leaving room for the human-readable SKU beside it.  
> 4. **The Mobile Camera Macro and Focal Distance Limitation**: Smartphone cameras possess fixed minimum focal lengths (typically 8\\text{ to }10\\text{ cm}). When a user brings a phone closer than 8\\text{ cm} to capture a tiny 6\\text{ mm} code, the lens enters optical blur and focus hunts continuously. Furthermore, showroom LED spotlights induce specular glare on the direct-thermal paper tag surface. Keeping the SKU concise (14\\text{--}16\\text{ characters}) keeps the Data Matrix or QR grid coarse, ensuring that smartphone camera sensors capture sufficient pixels per module (\>3\\text{ pixels/module}) from a stable distance of 12\\text{--}15\\text{ cm}.

| Engineering Metric | 1D Code 128 (Pointer Mode) | 2D Data Matrix ECC 200 | 2D QR Code (ISO/IEC 18004\) |
| :---- | :---- | :---- | :---- |
| **Payload Representation** | 8-digit numeric surrogate key (90482101) | Full 21-char Alphanumeric SKU (TMPNECCHK...) | Full 21-char Alphanumeric SKU (TMPNECCHK...) |
| **Printable Footprint (300\\text{ DPI})** | 14.5\\text{ mm} \\times 5.0\\text{ mm} | 6.5\\text{ mm} \\times 6.5\\text{ mm} | 9.5\\text{ mm} \\times 9.5\\text{ m\[span\_211\](start\_span)\[span\_211\](end\_span)m} |
| **Quiet Zone Requirement** | \\\[span\_212\](start\_span)\[span\_212\](end\_span)ge 10X each side | 1X module margin | 4X module margin |
| **Mobile Camera Scan Ease** | Moderate (requires steady framing) | High (via ML Kit / camera SDK) | Highest (native OS camera support) |
| **Dedicated 2D Handheld Reader** | Supported across all laser/imagers | Supported on all 2D CMOS imagers | Supported on all 2D CMOS imagers |
| **Physical Damage Recovery** | 0% (check digit only detects errors) | Up to 30% via Reed-Solomon ECC 200 | Up to 25%–30% (Level M / H) |
| **Tag Space Utilization** | Consumes most of a 32\\text{ mm} face | Minimal footprint; maximizes label space | Fits a 32\\text{ mm} face beside the SKU |

### **Administrative Mode-Switching Architecture**

Because different retail and wholesale operations employ varied hardware fleets—ranging from legacy 1D laser scanners and low-cost USB barcode wands to high-performance 2D CMOS wireless imagers (such as the Helett HT20pro) and mobile smartphone camera fleets—the inventory software must not hardcode a single symbology.  
Instead, the core system exposes an **Administrative Symbology Engine** where authorized administrators configure and toggle the symbology mode globally, per branch, or per printing terminal.  
The system state is governed by a dedicated configuration entity in the database:  
system\_symbology\_config  
\-------------------------------------------------------------  
\- config\_id               : INT PRIMARY KEY  
\- store\_location\_id       : VARCHAR(8) (e.g., 'WH-01', 'RET-CH01')  
\- active\_symbology\_mode   : ENUM('1D\_CODE128\_POINTER',   
                                 '2D\_DATAMATRIX\_ECC200',   
                                 '2D\_QRCODE')  
\- tag\_form\_factor         : VARCHAR(16) (e.g., 'STRIP\_14X100\_3UP')  
\- printer\_dpi             : INT (e.g., 203, 300, 600\)  
\- mobile\_camera\_engine    : ENUM('ML\_KIT', 'ZXING', 'SCANDIT')  
\- updated\_by\_admin\_id     : VARCHAR(16)  
\- updated\_timestamp       : TIMESTAMP

When an administrator alters the symbology toggle in the software console, the platform dynamically reconfigures three runtime pipelines:

> 1. **Dynamic Thermal Transfer Print Dispatch (ZPL/TSPL Engine)**:  
   * **Page geometry**: The job page is 45 \\times 100\\text{ mm} for the 3-up roll, holding three 14.3\\text{ mm} lanes at 15\\text{ mm} pitch. The 64\\text{ mm} body is printed at the leading edge of each lane and folds at 32\\text{ mm}; the trailing 36\\text{ mm} tail is never printed. A 1-up roll uses a 14.3 \\times 100\\text{ mm} page with the same body.  
   * **If Mode \= 1D\_CODE128\_POINTER**: The template compiler binds the print job using the 1D barcode command (^BC in Zebra ZPL or BARCODE in TSPL). It fetches the unique auto-incremented surrogate numeric pointer ID (pointer\_id), prints the barcode on the 32\\text{ mm} code face, and prints the human-readable alphanumeric SKU, MRP, and size on the opposite 32\\text{ mm} face.  
   * **If Mode \= 2D\_DATAMATRIX\_ECC200**: The compiler switches to the 2D matrix command (^BX in ZPL: ^BXN,4,200 for ECC 200 Data Matrix). It directly encodes the full 21-character alphanumeric Child Variant SKU (TMPNECCHK04821-MGRBSTD) within a 6.5 \\times 6.5\\text{ mm} square on the 32\\text{ mm} code face; the opposite face prints the SKU, MRP, and HSN code.  
   * **If Mode \= 2D\_QRCODE**: The compiler invokes the QR command (^BQN,2,4 in ZPL). It encodes the full child SKU string with Level M error correction, placing the 9 \\times 9\\text{ mm} code on the 32\\text{ mm} code face.  
> 2. **Scanner Input Resolution Pipeline**:  
   * The backend Point of Sale (POS) and inventory inwarding listener inspects the incoming scanned string length and structure:  
     * If the payload is a purely numeric 8-to-10 digit string, the parser routes it through the indexed surrogate key lookup (SELECT \* FROM product\_variants WHERE pointer\_id \= ?).  
     * If the payload contains standard category dashes (e.g., length 21 containing \-), the parser performs an immediate primary key match (SELECT \* FROM product\_variants WHERE variant\_sku \= ?).  
   * This design guarantees **backward compatibility**: if an administrator switches the store from 1D Barcode mode to 2D Data Matrix mode, existing inventory tagged with older 1D dumbbell labels can still be scanned and billed alongside newly printed 2D tags without data clashes.  
> 3. **Character Sanitation Enforcement**: Regardless of the active administrative symbology mode, the SKU generator enforces strict character hygiene:  
   * **Homoglyph Elimination**: Prohibits ambiguous characters O vs 0, I vs 1 vs l, and Z vs 2 in human-readable segments.  
   * **Special Character Bans**: Slashes (/), colons (:), spaces, ampersands (&), and underscores (\_) are prohibited to avoid corrupting ZPL printer formatting scripts, REST JSON payloads, or CSV import streams.  
   * **Single Delimiter**: The standard hyphen (-) is the sole permissible delimiter between parent archetype codes and variant segments.

## **Digital Asset Pipeline and Mobile Camera Vision Architecture**

In the non-precious jewellery sector, photographic documentation serves as a critical operational control rather than a simple e-commerce convenience. Because many imitation jewellery styles share identical technical attributes—such as a "copper-alloy antique gold necklace set with synthetic ruby and pearls"—visual differentiation is essential. Two pieces with identical attribute categorizations can feature entirely distinct artistic silhouettes, hand-carved repoussé depths, and aesthetic finishes.  
The software platform couples digital media asset storage with mobile computer vision routines across inventory inwarding, cycle counting, and point-of-sale verification.  
\+--------------------------------------------------------------+  
|            MOBILE CAMERA WORKFLOW: REAL-TIM\[span\_40\](start\_span)\[span\_40\](end\_span)E AUDIT           |  
\+--------------------------------------------------------------+  
  \[ Camera Viewfinder (2x Sensor Crop) \]  
       |  
  \[span\_41\](start\_span)\[span\_41\](end\_span)     v (Scans 2D Data Matrix / Barcode from 15 cm)  
  \[ Fast Decoder (Google ML Kit / Vision Framework) \]  
       |  
       v (Extracts: TMPNECCHK04821-MGRBSTD)  
  \[ Cloud ERP / Local POS In-Memory Cache Lookup \]  
       |  
       \+---------------------------------------+  
       | POS / INWARDING AUDIT UI DISPLAY      |  
       |---------------------------------------|  
       | \[ 120x120 Thumbnail: Hero Image \]     |  
       | SKU: TMPNECCHK04821-MGRBSTD           |  
       | Name: Antique Temple Choker Ruby      |  
       | Price: MRP ₹1,499  |  HSN: 71179010   |  
       | Status: OK \- Visual Match C\[span\_13\](start\_span)\[span\_13\](end\_span)\[span\_15\](start\_span)\[span\_15\](end\_span)onfirmed   |  
       \+---------------------------------------+

### **Deterministic Image Naming and Normalized Storage Architecture**

To maintain relational integrity, the media ingestion pipeline enforces deterministic file naming derived directly from parent style and variant codes:  
\\text{FileName} \= \\text{ParentSKU} \\math\[span\_240\](start\_span)\[span\_240\](end\_span)\[span\_242\](start\_span)\[span\_242\](end\_span)bin{\\Vert} \\text{"\\\_"} \\mathbin{\\Vert} \\text{PlatingColorCode} \\mathbin{\\Vert} \\text{"\\\_"} \\mathbin{\\Vert} \\text{ShotType} \\mathbin{\\Vert} \\text{"\\\_"} \\mathbin{\\Vert} \\text{Sequence} \\mathbin{\\Vert} \\text{"."} \\mathbin{\\Vert} \\text{Ext}  
The shot type token standardizes visual cataloging:

> * HERO: Master front-facing studio perspective positioned on an untextured, neutral background.  
> * MACR: High-magnification macro shot highlighting stone prong security, foil work, and electroplating texture.  
> * REVR: Reverse-angle shot documenting backside finish, Meenakari enameling, or hinge construction.  
> * SCAL: Dimensional scale reference photographed against a metric ruler, display bust, or model.

Applying this standard yields structured filenames such as TMPNECCHK04821\_MGRB\_HERO\_01.webp\[span\_262\](start\_span)\[span\_262\](end\_span).  
Binary media assets are decoupled from core database tables to maintain query performance across catalogs exceeding 100,000 styles:

| Master Database Entity | Dependent Media Registry Table | Foreign Key Cascade Constraints | Critical Tracking Columns | Operational Verification Rules |
| :---- | :---- | :---- | :---- | :---- |
| product\_styles (Parent Entity) | style\_media\_assets | parent\_sku \\rightarrow product\_styles.sku (Restrict on Delete) | asset\_id (UUID), parent\_sku, storage\_url, content\_hash (SHA-256), shot\_type, is\_canonical | Ensures master designs cannot be purged while referenced by live transactions |
| product\_variants (Child Entity) | variant\_media\_overrides | variant\_sku \\rightarrow product\_variants.sku (Restrict on Delete) | variant\_sku, asset\_id, display\_order | Resolves specific finish/colorway imagery during POS checkout and wholesale picking |

### **Mobile Camera Operational Workflows**

Equipping staff smartphones with camera scanning streamlines warehouse and retail floor operations without requiring expensive dedicated hardware everywhere:

> 1. **Mobile Stock Inwarding (Tag-to-Image Binding)**:  
   * When an intake coordinator unboxes new supplier shipments, the mobile application guides them through a unified flow: photograph the item using the smartphone camera (saving the canonical HERO image directly to cloud storage) followed by an immediate scan of the printed dumbbell tag.  
   * The app binds the image asset UUID to the newly generated variant\_sku in a single database transaction, eliminating detached image directories.  
> 2. Mobile Showroom Selling & Fraud Mitigation (Ticket-Switching):  
   * In retail fashion jewellery, ticket-switching (swapping a low-cost tag from a simple stud onto an elaborate bridal necklace) is a frequent source of shrinkage.  
   * When a cashier scans a tag via the mobile camera or 2D scanner, the app interface instantly displays a high-contrast 120 \\times 120\\text{ px} thumbnail of the item's canonical hero image alongside the scanned description and MRP.  
   * This provides an instant visual verification: if the tag reads "₹299 Studs" but displays a heavy necklace, the cashier flags the discrepancy immediately.  
> 3. **Optical Compensations in the Mobile Application**:  
   * **2\\times Digital Sensor Crop / Auto-Zoom**: Because small dumbbell tags trigger lens focus blur when the phone is held closer than 8\\text{ cm}, the in-app camera viewfinder locks to a default 2\\times center sensor crop. This enables staff to hold the mobile phone at a comfortable focal distance of 15\\text{--}20\\text{ cm} while feeding a crisp, high-resolution crop of the 2D Data Matrix or Barcode to the decoder library (e.g., Google ML Kit Barcode Scanning API).  
   * **Auto-Torch Toggle**: Imitation jewellery tags are often scanned under high-angle directional spotlights, which produce specular glare on glossy label surfaces. The app UI provides an auto-torch button that provides diffuse, uniform illumination to eliminate glare-induced decoding failures.  
> 4. **Wholesale Batch Multi-Scan vs. Dedicated 2D Wireless Scanners**:  
   * For store audits and stock cycle counts, the mobile app includes a "Continuous Sweep Mode" that captures and tallies dozens of tags in seconds without requiring manual trigger presses.  
   * **Hardware Fleet Trade-offs**: In high-throughput wholesale dispatch stations handling hundreds of units per carton, mobile phone cameras exhibit latency bottlenecks (300\\text{--}600\\text{ ms} focus-and-decode loop per scan) and cause ergonomic hand fatigue. High-volume packing stations therefore deploy dedicated 2D wireless imagers (such as the Helett HT20pro), which offer instantaneous \<50\\text{ ms} decode cycles on tiny 2D Data Matrix symbols and 1D codes via dedicated hardware CMOS imaging chips. The software supports both scanning devices identically via unified keyboard-wedge and camera-stream endpoints.

## **End-to-End Enterprise Integration: Invoicing, Fiscal Compliance, and Inventory Lifecycle**

Operating an automated inventory and billing platform within the non-precious jewellery sector requires seamless alignment with statutory fiscal frameworks. In India, imitation jewellery is classified under Chapter Heading 7117 of the Harmonized System of Nomenclature (HSN).  
Unlike fine jewelry falling under HSN 7113—which requires itemized tax accounting for base metal melt values, purity assays, stone carats, and separate fabrication charges—non-precious jewellery is invoiced as a finished article taxed at a unified rate of 3% GST.  
This 3% tax is split into 1.5% CGST plus 1.5% SGST for intra-state sales, or assessed as a unified 3% IGST on inter-state wholesale shipments and export-import consignments.  
The SKU generation engine programmatically maps 8-digit HSN subheadings based on product properties to ensure tax compliance:

> * Base-metal bangles: 7117 19 10  
> * German silver jewelry: 7117 19 20  
> * Items studded with synthetic stones, glass, or faux pearls: 7117 90 10  
> * Base-metal cufflinks and studs: 7117 11 00\[span\_311\](start\_span)\[span\_311\](end\_span)\[span\_312\](start\_span)\[span\_312\](end\_span)\[span\_313\](start\_span)\[span\_313\](end\_span)  
> * Miscellaneous fashion jewellery: 7117 90 90\[span\_314\](start\_span)\[span\_314\](end\_span)\[span\_315\](start\_span)\[span\_315\](end\_span)\[span\_316\](start\_span)\[span\_316\](end\_span)

Automating HSN derivation within the SKU master schema prevents manual tax classification errors during fast-paced billing operations.  
The operational lifecycle connects inventory registration, automated barcoding, physical warehouse management, and sales invoicing through an integrated technical process:

> 1. **Intake and Master Style Registration**: Sourcing teams log new shipments by selecting taxonomic attributes (style\_genre\_code, category\_code, subcategory\_code). The software increments the centralized partition counter to generate the Parent Style SKU (TMPNECCHK04821). At the mobile inwarding station, high-resolution photographs are captured on smartphone cameras, renamed via deterministic scripts, and linked to the parent record.  
> 2. **Variant Generation and Tag Printing**: The intake coordinator selects active platings, colorways, and sizes from the attribute matrix. The engine generates child variants and queues barcode print jobs for the direct-thermal 203 dpi printer loaded with the 14.3 \\times 100\\text{ mm} 3-up fold-in-half jewellery roll. Based on the active **Admin Symbology Setting**, the printer automatically outputs the selected format: a high-density 2D Data Matrix ECC 200, a 2D QR Code, or a compressed 1D Code 128 numeric pointer.  
> 3. **Storage and Fulfillment Routing**: Labeled items are moved to designated warehouse bins or showroom trays. Wholesale multi-packs receive parent-linked pack-tier labels (-C12, \-B06, \-G01) that map directly to wholesale volume pricing tables.  
> 4. **Point of Sale and Wholesale Invoicing**: Scanning an item tag at a retail counter—via either a smartphone camera running the mobile POS app or a wireless 2D handheld scanner—decodes the SKU, renders the canonical product thumbnail for anti-fraud verification, decrements inventory by one unit, and applies the 3% GST calculation. In wholesale operations, scanning a multi-pack code decrements the base variant inventory balance by the corresponding multiplier (e.g., 12 units for \-C12) while applying wholesale contract terms. Live stock levels synchronize instantly across both retail counters and wholesale order-management portals.

## **Architectural Synthesis**

Designing a scalable inventory and billing engine for non-precious jewellery requires avoiding two common software design pitfalls: unstructured random sequence numbers that fail to convey meaning to warehouse staff, and overly complex, rigid "smart" SKUs that expand beyond label printing limits. Because fast-fashion and imitation jewellery catalogs feature rapid design churn across thousands of visual silhouettes, systems require a balanced, modular architecture.  
The hybrid hierarchical architecture provides this balance:

> * **Parent Style SKUs** preserve core design identity, anchor visual digital assets, and enable aggregate style performance tracking.  
> * **Child Variant SKUs** provide precise, deterministic inventory control across finishes, stone colors, dimensional sizes, and wholesale multi-pack units.  
> * **Symbology Versatility & Admin Mode Control** allow administrators to configure the active tagging standard—toggling seamlessly between high-density 2D Data Matrix ECC 200 (optimal for small tags and 2D imagers), 2D QR codes (for native camera compatibility), and 1D Code 128 pointer IDs (for legacy laser scanners) without breaking historical inventory data.  
> * **Mobile Camera Vision Engine** equips smartphones with 2\\times cropped viewfinders, batch multi-scanning, and auto-torch illumination, enabling seamless stock inwarding, shelf audits, and POS billing while mitigating optical macro limitations.  
> * **Digital Media Linking** uses deterministic naming conventions that tie photography directly to SKU records, enabling instant visual audits at checkout to eliminate ticket-switching fraud.  
> * **Fiscal Integration** maps product properties to 8-digit HSN 7117 classifications, automating GST invoicing across retail and wholesale transactions.

Implementing this structured architecture eliminates SKU cross-contamination, supports high-speed barcode scanning, simplifies wholesale trade conversions, and provides non-precious jewellery enterprises with a stable foundation to manage inventory at scale.

#### **Works cited**

1\. Jewelry eCommerce Store: Easy Inventory Management, https\://www\.elsner.com/inventory-management-for-jewelry-ecommerce-store/ 2\. Best ERP for Jewellery Industry in India (2026 Guide), https\://www\.jsofterp.com/best-erp-for-jewellery-industry-in-india/ 3\. Jewelry wholesale software \- GPOS System, https\://gposs.com/jewelry-wholesale-software/ 4\. Jewellery Inventory Management Software \- Havteq Solutions, https\://havteq.com/blog/jewellery-inventory-management-software/ 5\. How to Manage Gold, Diamond & Silver Inventory Without Errors, https\://jewelsteps.com/how-to-manage-gold-diamond-silver-inventory/ 6\. FeelOri Glossary of Indian Fashion & Heritage Jewellery, https\://feelori.com/pages/jewelry-glossary 7\. Artificial Jewellery HSN Code 7117: GST Rate & Details \- GimBooks, https\://www\.gimbooks.com/blog/artificial-jewellery-hsn-code-gst-rates-7117-imitation-jewellery/ 8\. Western Jewellery Wholesale Supplier in Mumbai \- Manek Ratna, https\://www\.manekratna.com/designer-jewellery/western-jewellery.html 9\. Gemora Global | Jaipur Imitation Jewellery Exporter | Wholesale, https\://www\.gemoraglobal.co/ 10\. Brass Kundan Stones Fashion Jewellery Set in Chennai \- Justdial, https\://www\.justdial.com/jdmart/Chennai/Brass-Kundan-stones-Fashion-Jewellery-Set/jdm-1486602-ent-5-24417478 11\. Sapna FX Copper Temple Jewellery Necklace Set, Box Packing, https\://www\.indiamart.com/proddetail/temple-jewellery-necklace-set-21071216312.html 12\. What does SKU stand for? A guide to using SKUs in your business, https\://www\.fishbowlinventory.com/blog/what-does-sku-stand-for 13\. 90-Day Variant Management Plan to Stop Oversells for Jewelry, https\://www\.jewelcloud.com/blogs/news/variant-management-jewelry 14\. Stock Keeping Unit (SKU): Definition, Benefits, & Best Practices, https\://arirms.com/stock-keeping-unit-sku-definition-best-practices-example-and-benefits 15\. Full text of "Price list and diary for 1898." \- Internet Archive, https\://archive.org/stream/pricelistdiaryfo00spen/pricelistdiaryfo00spen\_djvu.txt 16\. How to Centralize Jewelry Inventory: The Definitive Guide for, https\://www\.valigara.com/jewelry-ecommerce-articles/how-to-centralize-jewelry-inventory-the-definitive-guide-for-scaling-brands/ 17\. GST on Artificial Jewellery in India: What Buyers & Sellers Must Know, https\://manekratna.com/blog/gst-on-artificial-jewellery/ 18\. Indian Bangle Size Guide: How to Measure Your Bangle Size (2.4, https\://vikavijewelry.com/blogs/news/indian-bangle-size-guide-how-to-measure-your-bangle-size-2-4-2-6-2-8-chart 19\. South Indian Bangle Size Guide (2.4 to 2.10) — Saandhavi Jewels, https\://saandhavijewels.in/guides/bangle-size-guide 20\. Silver Plated Bangles: Elevate Your Style Effortlessly \- gehna official, https\://gehnaofficial.com/collections/american-diamond-bangles/products/silver-plated-bangles 21\. Jewelry Dumbbell Tag — Free CODE128 Barcode Label Template, https\://www\.cleverence.com/label/templates/gallery-jewelry-dumbbell-tag 22\. Scale Jewelry SKUs Without Renumbering After 300–500 Active, https\://www\.jewelcloud.com/blogs/news/sku-strategy-jewelry 23\. Shopify Jewelry Inventory Management: The 2026 Scaling Guide, https\://www\.valigara.com/jewelry-ecommerce-articles/shopify-jewelry-inventory-management-the-2026-scaling-guide/ 24\. Fashion Jewellery Set in Chennai \- Justdial Verified \- Justdial, https\://www\.justdial.com/jdmart/Chennai/Fashion-Jewellery-Set/jdm-1045177-ent-2-12543058 25\. Custom Hang Tags, Cloth Tags & Jewellery Tags Guide | AdOn Print, https\://www\.adonprint.com/blog/cloth-tags-jewellery-tags-hang-tags-complete-guide 26\. Barcode Labels Supplier in Dubai, Abu Dhabi, UAE | SoluWise, https\://soluwiseme.com/barcode-labels/ 27\. Barcode Label Design and Print Software | RetailCore Technologies, https\://www\.coresoftware.in/barcode-label-design-and-print-software 28\. Intro to Barcodes: Understanding 1D and 2D Symbologies, https\://www\.idplate.com/blog/introduction-barcode-1d-and-2d-barcode-symbologies/ 29\. Types of barcodes explained: 1D vs 2D and which standard to use, https\://get.tana.app/articles/barcode-types/ 30\. Types of Barcodes: Choosing the Right Barcode \- Scandit, https\://www\.scandit.com/resources/guides/types-of-barcodes-choosing-the-right-barcode/ 31\. Code 128 \- Wikipedia, https\://en.wikipedia.org/wiki/Code\_128 32\. What is the difference between the two Barcode symbology types, https\://support.labfolder.com/support/solutions/articles/19000125902-the-difference-between-the-two-barcode-symbology-types-code-128-and-data-matrix 33\. Code 128 Barcode Specifications and Character Set, https\://www\.barcodesinc.com/articles/code128.htm 34\. GS1 Image Standards | Master Product Photography For Datapool, https\://www\.commport.com/gs1-image-standards/ 35\. facelets \- Manek Ratna, https\://www\.manekratna.com/jewellery-collection/Facelets.html 36\. Product Data Audit for B2B Catalogues: 90-Minute Checklist, https\://www\.greybath.com/blog/product-data-drift-audit-b2b 37\. How Much Does It Cost to Build a DAM Integration?, https\://www\.abbacustechnologies.com/how-much-does-it-cost-to-build-a-dam-integration/ 38\. GST Rates & HSN Code 7117 \- Imitation Jewellery \- Enterslice, https\://enterslice.com/learning/hsn-code/7117/ 39\. Jewellery GST & HSN Code Guide for India (2026) \- Tally Solutions, https\://tallysolutions.com/gst/jewellery-hsn-code-gst-rate-classification-invoicing-guide-for-businesses/ 40\. Imitation Jewellery HSN Code 7117: 3% GST | EximPe, https\://eximpe.com/hsn/imitation-jewellery-hsn-code 41\. Jewelry Tag Printer Packages – Barcode & RFID Tagging | WJewel, https\://www\.wjewel.com/tag-printer-packages.php