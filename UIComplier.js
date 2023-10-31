const fs = require("fs");
const path = require("path");
const constants = require("./constants.js");
const alignMap = {
    "left": "Qt::AlignLeft",
    "right": "Qt::AlignRight",
    "top": "Qt::AlignTop",
    "bottom": "Qt::AlignBottom",
    "center": "Qt::AlignCenter",
    "hcenter": "Qt::AlignHCenter",
    "vcenter": "Qt::AlignVCenter"
};

const sizePolicyMap =
{
    "expand": "QSizePolicy::Expanding",
    "min": "QSizePolicy::Minimum",
    "max": "QSizePolicy::Maximum",
    "prefer": "QSizePolicy::Preferred",
    "minexpand": "QSizePolicy::MinimumExpanding",
    "ignored": "QSizePolicy::Ignored"
};
const layoutEnum = ["QGridLayout", "QHBoxLayout", "QVBoxLayout"];

const orientationMap = { "hor": "Qt::Horizontal", "ver": "Qt::Vertical" }

function localdomain(callback) {
    let result = "{\n";
    result += callback();
    result += "}\n";
    return result;
}


function objField(obj, field, callback) {
    if (obj.hasOwnProperty(field)) {
        callback(obj[field]);
    }
}

function deepMerge(target, source) {
    // 遍历源JSON对象
    for (const key of Object.keys(source)) {
        // 如果源对象当前属性是一个JSON对象，则递归地对其进行合并
        if (source[key] instanceof Object) {
            Object.assign(source[key], deepMerge(target[key], source[key]))
        }
    }
    // 合并所有属性
    return Object.assign({}, target, source)
}

function checkLayout(cls) {
    return layoutEnum.indexOf(cls) != -1;
}

function parseUIFile(uiFile, dstdir) {
    let members = ""
    let objNum = 0;
    let initui = "";
    let fileContent = fs.readFileSync(uiFile).toString();
    if (!fileContent) {
        return;
    }
    let metaInfo = JSON.parse(fileContent);
    let uiInfo = metaInfo["body"];
    let depInfo = metaInfo["include"];
    let elementsMap = metaInfo["elements"];
    let templatesMap = metaInfo["templates"];
    if (!uiInfo) {
        throw "";
    }

    let viewName = path.basename(uiFile, ".cui");
    let viewFile = path.join(dstdir, `UI${viewName}.h`);
    if (fs.existsSync(viewFile)) {
        let dstUtime = fs.statSync(viewFile).mtime;
        let srcUtime = fs.statSync(uiFile).mtime;
        let scriptUtime = fs.statSync(__filename).mtime;
        if (dstUtime >= srcUtime && dstUtime >= scriptUtime) {
            return;
        }
    }


    function createLayout(layoutInfo) {
        if (!layoutInfo["class"]) {
            throw "unkonw class";
        }
        let layout = "";
        let name = "";
        //判断该变量是否具名，具名变量放置在成员变量列表中
        if (layoutInfo.hasOwnProperty("id")) {
            name = `_${layoutInfo["id"]}`;
            layout += `${name}=new ${layoutInfo["class"]};\n`;
            members += `${layoutInfo["class"]} *${name}=nullptr;`;
        }
        else {
            name = `layout${objNum++}`;
            layout += `auto ${name}=new ${layoutInfo["class"]};\n`;
        }
        layout += createProperty(name, layoutInfo["class"], layoutInfo["attributes"]);
        return { "name": name, "class": layoutInfo["class"], "layout": layout };
    }

    function createWidget(widgetInfo) {
        if (!widgetInfo["class"]) {
            throw "unkonw class";
        }
        let widget = "";
        let name = "";
        //判断该变量是否具名，具名变量放置在成员变量列表中
        if (widgetInfo["id"]) {
            name = `_${widgetInfo["id"]}`;
            widget += `${name}=new ${widgetInfo["class"]};\n`;
            members += `${widgetInfo["class"]} *${name}=nullptr;`
        }
        else {
            name = `widget${objNum++}`;
            widget += `auto ${name}=new ${widgetInfo["class"]};\n`;
        }
        widget += createProperty(name, widgetInfo["class"], widgetInfo["attributes"]);
        return { "name": name, "class": widgetInfo["class"], "widget": widget };
    }



    function createChild(childInfo, parentWidget, parentLayout) {
        let result = "";
        let name = "";
        let layout = {};
        let widget = {};
        let isLayout = false
        let hasLayout = false;
        if (childInfo.hasOwnProperty("element")) {
            if (!elementsMap.hasOwnProperty(childInfo["element"])) {
                return "";
            }
            let elementInfo = elementsMap[childInfo["element"]];
            childInfo = deepMerge(elementInfo, childInfo);
            delete childInfo.element;
        }
        isLayout = checkLayout(childInfo["class"]);
        hasLayout = isLayout || childInfo.hasOwnProperty("layout");
        let layoutInfo = isLayout ? childInfo : childInfo["layout"];

        if (childInfo["class"] == "QSpacerItem") {
            let width = 20;
            let height = 20;
            let hor = sizePolicyMap["min"];
            let ver = sizePolicyMap["min"];
            let attributes = childInfo["attributes"];
            if (attributes) {
                if (attributes.hasOwnProperty("width")) {
                    width = attributes["width"];
                }
                if (attributes.hasOwnProperty("height")) {
                    height = attributes["height"];
                }
                if (attributes.hasOwnProperty("ver")) {
                    ver = sizePolicyMap[attributes["ver"]];
                }
                if (attributes.hasOwnProperty("hor")) {
                    hor = sizePolicyMap[attributes["hor"]];
                }
            }
            name = `item${objNum++}`;
            result += `auto ${name}=new QSpacerItem(${width},${height},${hor},${ver});\n`;
            result += `${parentLayout["name"]}->addSpacerItem(${name});\n`
            return result;
        }

        if (hasLayout) {
            layout = createLayout(layoutInfo);
            result += `${layout["layout"]}\n`;
        }
        if (!isLayout) {
            widget = createWidget(childInfo);
            result += `${widget["widget"]}\n`;
            if (hasLayout) {
                result += `${widget["name"]}->setLayout(${layout["name"]});\n`;
            }
            if (parentWidget) {
                result += `${widget["name"]}->setParent(${parentWidget["name"]});\n`;
            }
        }
        name = isLayout ? layout["name"] : widget["name"];
        if (parentLayout) {
            let layoutProperties = childInfo["layoutProperties"];
            if (parentLayout["class"] != "QGridLayout") {
                if (isLayout) {
                    result += `${parentLayout["name"]}->addLayout(${layout["name"]});\n`;
                }
                else {
                    result += `${parentLayout["name"]}->addWidget(${widget["name"]});\n`;
                }
            }
            else {
                result += localdomain(() => {
                    let result = "";
                    if (layoutProperties) {
                        if (layoutProperties.hasOwnProperty("row")) {
                            if (layoutProperties["row"] == "next") {
                                result += `int row=${parentLayout["name"]}->rowCount();\n`;
                            }
                            else {
                                result += `int row=${layoutProperties["row"]};\n`;
                            }
                        }
                        else {
                            result += `int row=GetLastRow(${parentLayout["name"]});\n`;
                        }
                        if (layoutProperties.hasOwnProperty("column")) {
                            result += `int column=${layoutProperties["column"]};\n`;
                        }
                        else {
                            result += `int column=GetLastColumn(${parentLayout["name"]},row);\n`;
                        }
                        if (layoutProperties.hasOwnProperty("width")) {
                            result += `int width=${layoutProperties["width"]};\n`;
                        }
                        else {
                            result += `int width=1;\n`;
                        }

                        if (layoutProperties.hasOwnProperty("height")) {
                            result += `int height=${parentLayout["height"]};\n`;
                        }
                        else {
                            result += `int height=1;\n`
                        }
                        result += `${parentLayout["name"]}->${isLayout ? "addLayout" : "addWidget"}(${name},row,column,height,width);\n`;
                    }
                    else {
                        result += `int row=GetLastRow(${parentLayout["name"]});\n`
                        result += `int column=GetLastColumn(${parentLayout["name"]},row);\n`
                        result += `${parentLayout["name"]}->${isLayout ? "addLayout" : "addWidget"}(${name},row,column,1,1);\n`;
                    }

                    return result;
                });
            }
            if (layoutProperties && layoutProperties["align"]) {
                let alignArr = layoutProperties["align"].split("|");
                let allAlign = [];
                for (let align of alignArr) {
                    if (alignMap.hasOwnProperty(align)) {
                        allAlign.push(alignMap[align]);
                    }
                }
                result += `${parentLayout["name"]}->setAlignment(${name},${allAlign.join("|")});`;
            }
        }

        if (!childInfo["children"]) {
            return result;
        }
        for (let child of childInfo["children"]) {
            if (isLayout) {
                result += createChild(child, parentWidget, { "class": layout["class"], "name": layout["name"] });
            }
            else {
                if (hasLayout) {
                    result += createChild(child, { "class": widget["class"], "name": widget["name"] }, { "class": layout["class"], "name": layout["name"] });
                }
                else {
                    result += createChild(child, { "class": widget["class"], "name": widget["name"] }, null);
                }
            }
        }
        return result;
    }



    function createProperty(name, cls, attributes) {
        if (!attributes) {
            attributes = {};
        }
        //是否设置size属性
        let attributesContent = "";
        if (attributes["size"]) {
            let size = attributes["size"];
            attributesContent += localdomain(() => {
                let result = "";
                result += `auto s=${name}->size();\n`;
                if (size["width"] >= 0) {
                    result += `s.setWidth(${size["width"]});\n`;
                }
                if (size["height"] >= 0) {
                    result += `s.setHeight(${size["height"]});\n`;
                }
                result += `${name}->resize(s);\n`;
                if (size.hasOwnProperty("max-width")) {
                    result += `${name}->setMaximumWidth(${size["max-width"]});\n`
                }
                if (size.hasOwnProperty("max-height")) {
                    result += `${name}->setMaximumHeight(${size["max-height"]});\n`
                }
                if (size.hasOwnProperty("min-width")) {
                    result += `${name}->setMinimumWidth(${size["min-width"]});\n`
                }
                if (size.hasOwnProperty("min-height")) {
                    result += `${name}->setMinimumHeight(${size["min-height"]});\n`
                }
                if (size.hasOwnProperty("fixed-width")) {
                    result += `${name}->setFixedWidth(${size["fixed-width"]});\n`
                }
                if (size.hasOwnProperty("fixed-height")) {
                    result += `${name}->setFixedHeight(${size["fixed-height"]});\n`
                }
                return result;
            });
            if (size["policy"]) {
                let policy = size["policy"];
                attributesContent += localdomain(() => {
                    let result = "";
                    result += `auto p=${name}->sizePolicy();\n`;
                    if (policy["hor"] && sizePolicyMap.hasOwnProperty(policy["hor"])) {
                        result += `p.setHorizontalPolicy(${sizePolicyMap[policy["hor"]]});\n`;
                    }
                    if (policy["ver"] && sizePolicyMap.hasOwnProperty(policy["ver"])) {
                        result += `p.setVerticalPolicy(${sizePolicyMap[policy["ver"]]});\n`;
                    }
                    result += `${name}->setSizePolicy(p);\n`;
                    return result;
                });
            }

        }
        //是否设置text属性
        if (attributes["text"]) {
            attributesContent += `${name}->setText(QObject::tr("${attributes["text"]}"));\n`;
        }


        //是否设置spacing属性
        if (checkLayout(cls)) {
            if (cls == "QGridLayout") {
                if (attributes.hasOwnProperty("spacing")) {
                    let spacing = attributes["spacing"];
                    if (spacing.hasOwnProperty("ver")) {
                        attributesContent += `${name}->setVerticalSpacing(${spacing["ver"]});\n`;
                    }
                    else {
                        attributesContent += `${name}->setVerticalSpacing(5);\n`;

                    }

                    if (spacing.hasOwnProperty("hor")) {
                        attributesContent += `${name}->setHorizontalSpacing(${spacing["hor"]});\n`;

                    }
                    else {
                        attributesContent += `${name}->setHorizontalSpacing(5);\n`;
                    }
                }
                else {
                    attributesContent += `${name}->setHorizontalSpacing(5);\n`;
                    attributesContent += `${name}->setVerticalSpacing(5);\n`;
                }
            }
            else {
                if (attributes.hasOwnProperty("spacing")) {
                    attributesContent += `${name}->setSpacing(${attributes["spacing"]});\n`;
                }
            }
        }

        //是否设置margin属性
        if (attributes["margins"]) {
            let margins = attributes["margins"].split(",");
            for (let i = margins.length; i < 4; i++) {
                margins[i] = 0;
            }
            attributesContent += `${name}->setContentsMargins(${margins.join(",")});\n`
        }

        //是否设置align属性
        if (attributes["align"]) {
            let alignArr = attributes["align"].split("|");
            let allAlign = [];
            for (let align of alignArr) {
                if (alignMap.hasOwnProperty(align)) {
                    allAlign.push(alignMap[align]);
                }
            }
            attributesContent += `${name}->setAlignment(${allAlign.join("|")});`;
        }

        //是否设置QT属性
        if (attributes["properties"]) {
            let properties = attributes["properties"];
            for (let key in properties) {
                attributesContent += `${name}->setProperty("${key}",${properties[key]});\n`;
            }
        }
        // 是否设置pixmap
        if (attributes["pixmap"]) {
            let pixmapPath = attributes["pixmap"];
            attributesContent += `${name}->setPixmap(QPixmap("${pixmapPath}"));\n`
            if (cls == "QLabel") {
                attributesContent += `${name}->setScaledContents(true);\n`;
            }
        }
        // 是否设置断行
        if (attributes["wordWrap"]) {
            if (cls == "QLabel") {
                attributesContent += `${name}->setWordWrap(${attributes["wordWrap"]});\n`;
            }
        }
        // 是否设置objcetName
        if (attributes["name"]) {
            attributesContent += `${name}->setObjectName("${attributes["name"]}");\n`;
        }
        // 是否设置方向属性
        if (attributes["orientation"]) {
            attributesContent += `${name}->setOrientation(${orientationMap[attributes["orientation"]]});\n`;
        }
        return attributesContent;
    }

    function Substitution(child) {
        if (child.hasOwnProperty("template")) {
            if (templatesMap && templatesMap.hasOwnProperty(child["template"])) {
                let template = JSON.stringify(templatesMap[child["template"]]);
                if (child.hasOwnProperty("parameters")) {
                    let parameters = child["parameters"];
                    for (let param in parameters) {
                        let regexp = new RegExp(`\\$\\{\\s*${param}\\s*\\}`, "g");
                        template = template.replace(regexp, parameters[param]);
                    }
                }
                // 
                template = template.replace(/,?"[^"]*"\s*:\s*"\$\{.*?}"/, "");
                child = JSON.parse(template);
            }
            else {
                throw `there is no template called "${child["template"]}" here,please check it out`;
            }
        }
        if (child.hasOwnProperty("children")) {
            let children = child["children"];
            for (let index in children) {
                children[index] = Substitution(children[index]);
            }
        }
        return child;
    }
    if (uiInfo.hasOwnProperty("children")) {
        let children = uiInfo["children"];
        for (let index in children) {
            children[index] = Substitution(children[index]);
        }
    }

    if (uiInfo["attributes"]) {
        initui += createProperty("that", uiInfo["class"], uiInfo["attributes"]);
    }

    let layout = {};
    if (uiInfo["layout"]) {
        layout = createLayout(uiInfo["layout"]);
        initui += `${layout["layout"]}\n`;
        initui += `that->setLayout(${layout["name"]});\n`;
    }

    if (uiInfo["children"]) {
        for (let child of uiInfo["children"]) {
            initui += createChild(child, { "class": uiInfo["class"], "name": "that" }, { "class": layout["class"], "name": layout["name"] });
        }
    }






    let includeFiles = "";

    if (depInfo["lib"]) {
        let lib = depInfo["lib"];
        for (let file of lib) {
            includeFiles += `#include<${file}>\n`;
        }
    }
    if (depInfo["user"]) {
        let user = depInfo["user"];
        for (let file of user) {
            includeFiles += `#include"${file}"\n`;
        }
    }

    let result = `
    #ifndef UI${viewName}_H
    #define UI${viewName}_H
    #include <qvariant.h>
    #include <qboxlayout.h>
    ${includeFiles}
    class Ui${viewName}
    {
        private:
        static inline int GetLastRow(QGridLayout *layout)
        {
            int row = layout->rowCount();
            return row < 1 ? 0 : row - 1;
        }

        static inline int GetLastColumn(QGridLayout *layout, int row)
        {
            int column = 0;
            for (int i = 0; i < layout->columnCount(); i++)
            {
                if (layout->itemAtPosition(row, i))
                {
                    column = i+1;
                }
            }
            return column;
        }
    
    
        public:
            Ui${viewName}(){};
        protected:
            void InitUI(QWidget *that)
            {
                ${initui}
            }
        protected:
            ${members}
    };
    #endif
    `
    for (let i = 0; i < 10; i++) {
        result = `//this file create ${path.basename(__filename)},please do not edit\n` + result;
    }

    fs.writeFileSync(viewFile, result);
}

if (require.main == module) {
    let uiFiles = process.argv.slice(2);
    let dstdir = path.join(constants.includeDir, "UI");
    if (!fs.existsSync(dstdir)) {
        fs.mkdirSync(dstdir, { recursive: true });
    }
    for (let file of uiFiles) {
        try {
            let filePath = file;
            if (!path.isAbsolute(filePath)) {
                filePath = path.join(process.cwd(), filePath);
            }
            if (path.extname(file) != ".cui") {
                continue;
            }
            parseUIFile(filePath, dstdir);
        } catch (error) {
            console.error(`-----------------------------------------------------------------`);
            console.error(`error,can not complier the ui file: "${file}"`);
            console.error(`-----------------------------------------------------------------`);
            console.error(error);
            process.exit(1);
        }
    }
}