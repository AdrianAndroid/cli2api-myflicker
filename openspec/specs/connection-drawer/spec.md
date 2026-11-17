# connection-drawer Specification

## Purpose
把连接与档案收进右侧抽屉：用户在工作区里可以从右上角快速切换连接档案、检查探活或重新粘贴连接串，不必离开当前会话页面。

## Requirements

### Requirement: Drawer Entry

控制台 SHALL 在页面右上角提供连接抽屉入口。

#### Scenario: 打开抽屉

- **WHEN** 用户点击右上角齿轮
- **THEN** 从右侧展开连接抽屉
- **AND** 背景变暗且不遮挡抽屉内容

#### Scenario: 任意角色

- **WHEN** 当前为服务机或使用机
- **THEN** 齿轮入口都可见

### Requirement: Drawer Content

抽屉 SHALL 复用连接页的能力，并适配窄宽度。

#### Scenario: 复用连接能力

- **WHEN** 抽屉打开
- **THEN** 可切换角色、查看档案、导入连接串、测试连接、保存并连接

#### Scenario: 窄宽度布局

- **WHEN** 抽屉宽度为 440px
- **THEN** 档案地址换行到下一行显示
- **AND** 操作按钮保持可见

### Requirement: Drawer Dismissal

抽屉 SHALL 支持多种关闭方式，并在连接成功后自动关闭。

#### Scenario: 手动关闭

- **WHEN** 用户点击关闭按钮、点击遮罩或按 Esc
- **THEN** 抽屉关闭，页面状态不变

#### Scenario: 连接成功

- **WHEN** 用户在抽屉里保存或切换档案成功
- **THEN** 抽屉自动关闭
- **AND** 工作区使用新的连接

### Requirement: Full Page Fallback

左栏「连接」整页 SHALL 保留，行为与抽屉一致。

#### Scenario: 整页兜底

- **WHEN** 用户从左侧导航进入「连接」
- **THEN** 看到与抽屉相同的档案与表单
- **AND** 不因抽屉存在而失效
