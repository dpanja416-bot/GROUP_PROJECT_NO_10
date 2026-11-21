"""Model architecture copied exactly from the training notebook."""
import torch
import torch.nn as nn
from torchvision.models import resnet18, ResNet18_Weights


class CBAM(nn.Module):
    def __init__(self, channels, reduction=16, spatial_kernel=7):
        super().__init__()
        hidden = max(channels // reduction, 1)
        self.channel_mlp = nn.Sequential(
            nn.Conv2d(channels, hidden, kernel_size=1, bias=False),
            nn.ReLU(inplace=True),
            nn.Conv2d(hidden, channels, kernel_size=1, bias=False),
        )
        self.channel_gate = nn.Sigmoid()
        self.spatial_conv = nn.Conv2d(2, 1, kernel_size=spatial_kernel,
                                      padding=spatial_kernel // 2, bias=False)
        self.spatial_gate = nn.Sigmoid()

    def forward(self, x):
        avg_descriptor = torch.mean(x, dim=(2, 3), keepdim=True)
        max_descriptor = torch.amax(x, dim=(2, 3), keepdim=True)
        channel_attention = self.channel_gate(
            self.channel_mlp(avg_descriptor) + self.channel_mlp(max_descriptor))
        x = x * channel_attention
        avg_map = torch.mean(x, dim=1, keepdim=True)
        max_map = torch.amax(x, dim=1, keepdim=True)
        spatial_attention = self.spatial_gate(self.spatial_conv(torch.cat([avg_map, max_map], dim=1)))
        return x * spatial_attention


class ResNet18CBAM(nn.Module):
    def __init__(self, num_classes=2, pretrained=False):
        super().__init__()
        weights = ResNet18_Weights.DEFAULT if pretrained else None
        self.backbone = resnet18(weights=weights)
        feature_count = self.backbone.fc.in_features
        self.backbone.fc = nn.Identity()
        self.cbam = CBAM(feature_count)
        self.classifier = nn.Linear(feature_count, num_classes)

    def forward(self, x):
        x = self.backbone.conv1(x)
        x = self.backbone.bn1(x)
        x = self.backbone.relu(x)
        x = self.backbone.maxpool(x)
        x = self.backbone.layer1(x)
        x = self.backbone.layer2(x)
        x = self.backbone.layer3(x)
        x = self.backbone.layer4(x)
        x = self.cbam(x)
        x = self.backbone.avgpool(x)
        x = torch.flatten(x, 1)
        return self.classifier(x)