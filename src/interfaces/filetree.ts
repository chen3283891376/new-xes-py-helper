// 从当年某个小项目里面刨出来的，如果未来顺利，你也许也能看到那个神秘小项目（笑
interface CursorPosition {
    row: number;
    column: number;
}

interface BaseFileNode {
    id: string;
    isSelected: boolean;
    level: number;
    isLeaf: boolean;
    isDir: boolean;
    name: string;
    percentage: number;
    loading: boolean;
    fileStatus: "normal";
    size: number;
    value: string;
    text: string;
    title: string;
    disabled: boolean;
    isExpanded: boolean;
    icon: string;
    type: "dir" | "oss_file" | "run";
    sort: number;
    mode: "client";
    pid: string | number;
    preClick: boolean;
    isChange: boolean;
    isActived: boolean;
    isOpen: boolean;
    operation: "uploadOk";
    state: "uploadOk";
}

export interface DirNode extends BaseFileNode {
    isDir: true;
    isLeaf: false;
    children: (DirNode | FileNode)[];
}

export interface FileNode extends BaseFileNode {
    isDir: false;
    isLeaf: true;
    children?: never;
    dataFormat: string;
    ext: string;
    svgId: string;
    originValue: string;
    assetId: string;
    md5ext: string;
    preview: boolean;
    editable: boolean;
    lang?: "python";
    color?: string;
    cursor?: CursorPosition;
}

interface TabItem extends FileNode {
    content: string;
    originValue: string;
    cursor: CursorPosition;
}

export interface FileTreeStructure {
    treeAssets: (DirNode | FileNode)[];
    tabsList: TabItem[];
    activeTab: TabItem;
    indexFile: string;
}
