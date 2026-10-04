var output = @"D:\Desktop\revitt\考生文件夹\照明模型+方昱.rvt";
if (System.IO.File.Exists(output))
    throw new System.InvalidOperationException("The output model already exists.");
var options = new SaveAsOptions { OverwriteExistingFile = false, MaximumBackups = 1 };
document.SaveAs(output, options);
return document.PathName;
