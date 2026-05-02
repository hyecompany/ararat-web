/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use std::borrow::Cow;

use crate::display_draw::DrawRect;

use super::texture::TextureRect;

const FILL_RING_MIN: usize = 16;

#[derive(Clone, Copy)]
pub(super) struct FillDraw {
    pub dest: DrawRect,
    pub color: u32,
}

#[derive(Clone, Copy)]
pub(super) enum TextureFilter {
    Nearest,
    Linear,
}

pub(super) struct FillPipeline {
    pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    slots: Vec<FillUniformSlot>,
    cursor: usize,
}

struct FillUniformSlot {
    buffer: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
}

pub(super) struct TextureRectPipeline {
    pipeline: wgpu::RenderPipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    nearest_sampler: wgpu::Sampler,
    linear_sampler: wgpu::Sampler,
}

pub(super) struct ComputeBlitPipeline {
    pipeline: wgpu::ComputePipeline,
    bind_group_layout: wgpu::BindGroupLayout,
}

pub(super) struct ComputeRopBlitPipeline {
    pipeline: wgpu::ComputePipeline,
    bind_group_layout: wgpu::BindGroupLayout,
}

pub(super) struct ComputeBitmapBlitPipeline {
    pipeline: wgpu::ComputePipeline,
    bind_group_layout: wgpu::BindGroupLayout,
}

pub(super) struct ComputeBitmapUnpackPipeline {
    pipeline: wgpu::ComputePipeline,
    bind_group_layout: wgpu::BindGroupLayout,
}

impl FillPipeline {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("spice-fill-bind-layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("spice-fill-pipeline-layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("spice-fill-shader"),
            source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(FILL_SHADER)),
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("spice-fill-pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        let mut pipeline = Self {
            pipeline,
            bind_group_layout,
            slots: Vec::new(),
            cursor: 0,
        };
        pipeline.ensure_slots(device, FILL_RING_MIN);
        pipeline
    }

    pub fn render(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        target_width: u32,
        target_height: u32,
        fills: &[FillDraw],
    ) -> Result<usize, String> {
        if fills.is_empty() {
            return Ok(0);
        }
        self.ensure_slots(device, fills.len().max(FILL_RING_MIN));
        for fill in fills {
            let slot = self.next_slot();
            queue
                .write_buffer_with(&slot.buffer, 0, wgpu::BufferSize::new(16).unwrap())
                .ok_or_else(|| "wgpu fill uniform staging allocation failed".to_string())?
                .copy_from_slice(&color_uniform_bytes(fill.color));
        }

        let mut rendered = 0;
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("spice-fill-primary-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.pipeline);
            let start = self.cursor_for_last(fills.len());
            for (index, fill) in fills.iter().enumerate() {
                let Some(rect) =
                    TextureRect::from_draw_rect(fill.dest, target_width, target_height)
                else {
                    continue;
                };
                let slot_index = (start + index) % self.slots.len();
                let slot = &self.slots[slot_index];
                pass.set_bind_group(0, &slot.bind_group, &[]);
                pass.set_viewport(
                    rect.x as f32,
                    rect.y as f32,
                    rect.width as f32,
                    rect.height as f32,
                    0.0,
                    1.0,
                );
                pass.set_scissor_rect(rect.x, rect.y, rect.width, rect.height);
                pass.draw(0..6, 0..1);
                rendered += 1;
            }
        }
        Ok(rendered)
    }

    fn ensure_slots(&mut self, device: &wgpu::Device, count: usize) {
        while self.slots.len() < count {
            let buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("spice-fill-uniform"),
                size: 16,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("spice-fill-bind-group"),
                layout: &self.bind_group_layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: buffer.as_entire_binding(),
                }],
            });
            self.slots.push(FillUniformSlot { buffer, bind_group });
        }
    }

    fn next_slot(&mut self) -> &FillUniformSlot {
        let index = self.cursor % self.slots.len();
        self.cursor = (self.cursor + 1) % self.slots.len();
        &self.slots[index]
    }

    fn cursor_for_last(&self, count: usize) -> usize {
        (self.cursor + self.slots.len() - (count % self.slots.len())) % self.slots.len()
    }
}

impl TextureRectPipeline {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("spice-texture-rect-bind-layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("spice-texture-rect-pipeline-layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("spice-texture-rect-shader"),
            source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(TEXTURE_RECT_SHADER)),
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("spice-texture-rect-pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        let nearest_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("spice-texture-rect-nearest-sampler"),
            mag_filter: wgpu::FilterMode::Nearest,
            min_filter: wgpu::FilterMode::Nearest,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            ..Default::default()
        });
        let linear_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("spice-texture-rect-linear-sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            ..Default::default()
        });
        Self {
            pipeline,
            bind_group_layout,
            nearest_sampler,
            linear_sampler,
        }
    }

    pub fn render(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::Texture,
        target: &wgpu::TextureView,
        dest: TextureRect,
        uv: [f32; 4],
        filter: TextureFilter,
    ) {
        let source_view = source.create_view(&wgpu::TextureViewDescriptor::default());
        let uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("spice-texture-rect-uniform"),
            size: 16,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: true,
        });
        uniform
            .slice(..)
            .get_mapped_range_mut()
            .copy_from_slice(&f32x4_bytes(uv));
        uniform.unmap();
        let sampler = match filter {
            TextureFilter::Nearest => &self.nearest_sampler,
            TextureFilter::Linear => &self.linear_sampler,
        };
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("spice-texture-rect-bind-group"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&source_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: uniform.as_entire_binding(),
                },
            ],
        });
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("spice-texture-rect-pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.set_viewport(
            dest.x as f32,
            dest.y as f32,
            dest.width as f32,
            dest.height as f32,
            0.0,
            1.0,
        );
        pass.set_scissor_rect(dest.x, dest.y, dest.width, dest.height);
        pass.draw(0..6, 0..1);
    }
}

impl ComputeBlitPipeline {
    pub fn new(device: &wgpu::Device) -> Self {
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("spice-compute-blit-bind-layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("spice-compute-blit-pipeline-layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("spice-compute-blit-shader"),
            source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(COMPUTE_BLIT_SHADER)),
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("spice-compute-blit-pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });
        Self {
            pipeline,
            bind_group_layout,
        }
    }

    pub fn dispatch(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::Texture,
        target: &wgpu::Texture,
        blit: super::texture::BlitRect,
    ) {
        let source_view = source.create_view(&wgpu::TextureViewDescriptor::default());
        let target_view = target.create_view(&wgpu::TextureViewDescriptor::default());
        let uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("spice-compute-blit-uniform"),
            size: 32,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: true,
        });
        uniform
            .slice(..)
            .get_mapped_range_mut()
            .copy_from_slice(&compute_blit_uniform_bytes(blit));
        uniform.unmap();
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("spice-compute-blit-bind-group"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&source_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&target_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: uniform.as_entire_binding(),
                },
            ],
        });
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("spice-compute-blit-pass"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.dispatch_workgroups(blit.dest.width.div_ceil(8), blit.dest.height.div_ceil(8), 1);
    }
}

impl ComputeRopBlitPipeline {
    pub fn new(device: &wgpu::Device) -> Self {
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("spice-compute-rop-blit-bind-layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("spice-compute-rop-blit-pipeline-layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("spice-compute-rop-blit-shader"),
            source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(COMPUTE_ROP_BLIT_SHADER)),
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("spice-compute-rop-blit-pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });
        Self {
            pipeline,
            bind_group_layout,
        }
    }

    pub fn dispatch(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::Texture,
        dest_snapshot: &wgpu::Texture,
        target: &wgpu::Texture,
        blit: super::texture::BlitRect,
        rop_descriptor: u16,
    ) {
        let source_view = source.create_view(&wgpu::TextureViewDescriptor::default());
        let dest_view = dest_snapshot.create_view(&wgpu::TextureViewDescriptor::default());
        let target_view = target.create_view(&wgpu::TextureViewDescriptor::default());
        let uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("spice-compute-rop-blit-uniform"),
            size: 48,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: true,
        });
        uniform
            .slice(..)
            .get_mapped_range_mut()
            .copy_from_slice(&compute_rop_blit_uniform_bytes(blit, rop_descriptor));
        uniform.unmap();
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("spice-compute-rop-blit-bind-group"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&source_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&dest_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&target_view),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: uniform.as_entire_binding(),
                },
            ],
        });
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("spice-compute-rop-blit-pass"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.dispatch_workgroups(blit.dest.width.div_ceil(8), blit.dest.height.div_ceil(8), 1);
    }
}

impl ComputeBitmapBlitPipeline {
    pub fn new(device: &wgpu::Device) -> Self {
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("spice-compute-bitmap-blit-bind-layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("spice-compute-bitmap-blit-pipeline-layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("spice-compute-bitmap-blit-shader"),
            source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(COMPUTE_BITMAP_BLIT_SHADER)),
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("spice-compute-bitmap-blit-pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });
        Self {
            pipeline,
            bind_group_layout,
        }
    }

    pub fn dispatch(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::Texture,
        dest_snapshot: &wgpu::Texture,
        target: &wgpu::Texture,
        blit: super::texture::BlitRect,
        rop_descriptor: u16,
        top_down: bool,
        preserve_alpha: bool,
    ) {
        let source_view = source.create_view(&wgpu::TextureViewDescriptor::default());
        let dest_view = dest_snapshot.create_view(&wgpu::TextureViewDescriptor::default());
        let target_view = target.create_view(&wgpu::TextureViewDescriptor::default());
        let uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("spice-compute-bitmap-blit-uniform"),
            size: 48,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: true,
        });
        uniform.slice(..).get_mapped_range_mut().copy_from_slice(
            &compute_bitmap_blit_uniform_bytes(blit, rop_descriptor, top_down, preserve_alpha),
        );
        uniform.unmap();
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("spice-compute-bitmap-blit-bind-group"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&source_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&dest_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&target_view),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: uniform.as_entire_binding(),
                },
            ],
        });
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("spice-compute-bitmap-blit-pass"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.dispatch_workgroups(blit.dest.width.div_ceil(8), blit.dest.height.div_ceil(8), 1);
    }
}

impl ComputeBitmapUnpackPipeline {
    pub fn new(device: &wgpu::Device) -> Self {
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("spice-compute-bitmap-unpack-bind-layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("spice-compute-bitmap-unpack-pipeline-layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("spice-compute-bitmap-unpack-shader"),
            source: wgpu::ShaderSource::Wgsl(Cow::Borrowed(COMPUTE_BITMAP_UNPACK_SHADER)),
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("spice-compute-bitmap-unpack-pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });
        Self {
            pipeline,
            bind_group_layout,
        }
    }

    pub fn dispatch(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::Buffer,
        params: &wgpu::Buffer,
        target: &wgpu::Texture,
        max_width: u32,
        max_height: u32,
        item_count: u32,
    ) {
        let target_view = target.create_view(&wgpu::TextureViewDescriptor::default());
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("spice-compute-bitmap-unpack-bind-group"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: source.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: params.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&target_view),
                },
            ],
        });
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("spice-compute-bitmap-unpack-pass"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.dispatch_workgroups(max_width.div_ceil(8), max_height.div_ceil(8), item_count);
    }
}

fn color_uniform_bytes(color: u32) -> [u8; 16] {
    let rgba = [
        ((color >> 16) & 0xff) as f32 / 255.0,
        ((color >> 8) & 0xff) as f32 / 255.0,
        (color & 0xff) as f32 / 255.0,
        1.0,
    ];
    f32x4_bytes(rgba)
}

fn f32x4_bytes(values: [f32; 4]) -> [u8; 16] {
    let mut bytes = [0; 16];
    for (index, value) in values.iter().enumerate() {
        bytes[index * 4..index * 4 + 4].copy_from_slice(&value.to_ne_bytes());
    }
    bytes
}

fn compute_blit_uniform_bytes(blit: super::texture::BlitRect) -> [u8; 32] {
    let values = [
        blit.dest.x,
        blit.dest.y,
        blit.dest.width,
        blit.dest.height,
        (blit.uv[0].clamp(0.0, 1.0) * u32::MAX as f32) as u32,
        (blit.uv[1].clamp(0.0, 1.0) * u32::MAX as f32) as u32,
        (blit.uv[2].clamp(0.0, 1.0) * u32::MAX as f32) as u32,
        (blit.uv[3].clamp(0.0, 1.0) * u32::MAX as f32) as u32,
    ];
    let mut bytes = [0; 32];
    for (index, value) in values.iter().enumerate() {
        bytes[index * 4..index * 4 + 4].copy_from_slice(&value.to_ne_bytes());
    }
    bytes
}

fn compute_rop_blit_uniform_bytes(blit: super::texture::BlitRect, rop_descriptor: u16) -> [u8; 48] {
    let values = [
        blit.dest.x,
        blit.dest.y,
        blit.dest.width,
        blit.dest.height,
        (blit.uv[0].clamp(0.0, 1.0) * u32::MAX as f32) as u32,
        (blit.uv[1].clamp(0.0, 1.0) * u32::MAX as f32) as u32,
        (blit.uv[2].clamp(0.0, 1.0) * u32::MAX as f32) as u32,
        (blit.uv[3].clamp(0.0, 1.0) * u32::MAX as f32) as u32,
        u32::from(rop_descriptor),
        0,
        0,
        0,
    ];
    let mut bytes = [0; 48];
    for (index, value) in values.iter().enumerate() {
        bytes[index * 4..index * 4 + 4].copy_from_slice(&value.to_ne_bytes());
    }
    bytes
}

fn compute_bitmap_blit_uniform_bytes(
    blit: super::texture::BlitRect,
    rop_descriptor: u16,
    top_down: bool,
    preserve_alpha: bool,
) -> [u8; 48] {
    let mut flags = 0u32;
    if top_down {
        flags |= 1;
    }
    if preserve_alpha {
        flags |= 2;
    }
    let values = [
        blit.dest.x,
        blit.dest.y,
        blit.dest.width,
        blit.dest.height,
        (blit.uv[0].clamp(0.0, 1.0) * u32::MAX as f32) as u32,
        (blit.uv[1].clamp(0.0, 1.0) * u32::MAX as f32) as u32,
        (blit.uv[2].clamp(0.0, 1.0) * u32::MAX as f32) as u32,
        (blit.uv[3].clamp(0.0, 1.0) * u32::MAX as f32) as u32,
        u32::from(rop_descriptor),
        flags,
        0,
        0,
    ];
    let mut bytes = [0; 48];
    for (index, value) in values.iter().enumerate() {
        bytes[index * 4..index * 4 + 4].copy_from_slice(&value.to_ne_bytes());
    }
    bytes
}

pub(super) fn compute_bitmap_unpack_item_bytes(
    source_width: u32,
    source_height: u32,
    source_stride_words: u32,
    blit: super::texture::BlitRect,
    source_offset_words: u32,
    top_down: bool,
    preserve_alpha: bool,
) -> [u8; 64] {
    let mut flags = 0u32;
    if top_down {
        flags |= 1;
    }
    if preserve_alpha {
        flags |= 2;
    }
    let values = [
        blit.dest.x,
        blit.dest.y,
        blit.dest.width,
        blit.dest.height,
        (blit.uv[0].clamp(0.0, 1.0) * u32::MAX as f32) as u32,
        (blit.uv[1].clamp(0.0, 1.0) * u32::MAX as f32) as u32,
        (blit.uv[2].clamp(0.0, 1.0) * u32::MAX as f32) as u32,
        (blit.uv[3].clamp(0.0, 1.0) * u32::MAX as f32) as u32,
        source_width,
        source_height,
        source_stride_words,
        flags,
        source_offset_words,
        0,
        0,
        0,
    ];
    let mut bytes = [0; 64];
    for (index, value) in values.iter().enumerate() {
        bytes[index * 4..index * 4 + 4].copy_from_slice(&value.to_ne_bytes());
    }
    bytes
}

const FILL_SHADER: &str = r#"
struct Params {
    color: vec4<f32>,
};

@group(0) @binding(0)
var<uniform> params: Params;

struct VertexOut {
    @builtin(position) position: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
    var positions = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(1.0, 1.0)
    );
    var out: VertexOut;
    out.position = vec4<f32>(positions[vertex_index], 0.0, 1.0);
    return out;
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
    return params.color;
}
"#;

const TEXTURE_RECT_SHADER: &str = r#"
struct Params {
    uv: vec4<f32>,
};

@group(0) @binding(0)
var source_texture: texture_2d<f32>;
@group(0) @binding(1)
var source_sampler: sampler;
@group(0) @binding(2)
var<uniform> params: Params;

struct VertexOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
    var positions = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(1.0, 1.0)
    );
    var uvs = array<vec2<f32>, 6>(
        vec2<f32>(params.uv.x, params.uv.w),
        vec2<f32>(params.uv.z, params.uv.w),
        vec2<f32>(params.uv.x, params.uv.y),
        vec2<f32>(params.uv.x, params.uv.y),
        vec2<f32>(params.uv.z, params.uv.w),
        vec2<f32>(params.uv.z, params.uv.y)
    );
    var out: VertexOut;
    out.position = vec4<f32>(positions[vertex_index], 0.0, 1.0);
    out.uv = uvs[vertex_index];
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    return textureSample(source_texture, source_sampler, in.uv);
}
"#;

const COMPUTE_BLIT_SHADER: &str = r#"
struct Params {
    dest: vec4<u32>,
    uv: vec4<u32>,
};

@group(0) @binding(0)
var source_texture: texture_2d<f32>;
@group(0) @binding(1)
var target_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2)
var<uniform> params: Params;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= params.dest.z || id.y >= params.dest.w) {
        return;
    }
    let source_dims = textureDimensions(source_texture);
    let dest_width = max(params.dest.z, 1u);
    let dest_height = max(params.dest.w, 1u);
    let u0 = f32(params.uv.x) / f32(0xffffffffu);
    let v0 = f32(params.uv.y) / f32(0xffffffffu);
    let u1 = f32(params.uv.z) / f32(0xffffffffu);
    let v1 = f32(params.uv.w) / f32(0xffffffffu);
    let u = mix(u0, u1, (f32(id.x) + 0.5) / f32(dest_width));
    let v = mix(v0, v1, (f32(id.y) + 0.5) / f32(dest_height));
    let sx = min(u32(clamp(u, 0.0, 0.999999) * f32(source_dims.x)), source_dims.x - 1u);
    let sy = min(u32(clamp(v, 0.0, 0.999999) * f32(source_dims.y)), source_dims.y - 1u);
    let color = textureLoad(source_texture, vec2<i32>(i32(sx), i32(sy)), 0);
    textureStore(
        target_texture,
        vec2<i32>(i32(params.dest.x + id.x), i32(params.dest.y + id.y)),
        color
    );
}
"#;

const COMPUTE_ROP_BLIT_SHADER: &str = r#"
struct Params {
    dest: vec4<u32>,
    uv: vec4<u32>,
    rop: vec4<u32>,
};

@group(0) @binding(0)
var source_texture: texture_2d<f32>;
@group(0) @binding(1)
var dest_snapshot_texture: texture_2d<f32>;
@group(0) @binding(2)
var target_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3)
var<uniform> params: Params;

fn color_to_byte(color: vec3<f32>) -> vec3<u32> {
    return vec3<u32>(round(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)) * 255.0));
}

fn byte_to_color(color: vec3<u32>) -> vec3<f32> {
    return vec3<f32>(color) / 255.0;
}

fn apply_draw_copy_rop(rop: u32, source_input: vec3<u32>, dest_input: vec3<u32>) -> vec3<u32> {
    var source = source_input;
    var dest = dest_input;
    if ((rop & 1u) != 0u) {
        source = vec3<u32>(255u) - source;
    }
    if ((rop & 4u) != 0u) {
        dest = vec3<u32>(255u) - dest;
    }

    var result = source;
    if ((rop & 8u) != 0u) {
        result = source;
    } else if ((rop & 16u) != 0u) {
        result = source | dest;
    } else if ((rop & 32u) != 0u) {
        result = source & dest;
    } else if ((rop & 64u) != 0u) {
        result = source ^ dest;
    } else if ((rop & 128u) != 0u) {
        result = vec3<u32>(0u);
    } else if ((rop & 256u) != 0u) {
        result = vec3<u32>(255u);
    } else if ((rop & 512u) != 0u) {
        result = vec3<u32>(255u) - dest;
    }

    if ((rop & 1024u) != 0u) {
        result = vec3<u32>(255u) - result;
    }
    return result;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= params.dest.z || id.y >= params.dest.w) {
        return;
    }
    let source_dims = textureDimensions(source_texture);
    let dest_width = max(params.dest.z, 1u);
    let dest_height = max(params.dest.w, 1u);
    let u0 = f32(params.uv.x) / f32(0xffffffffu);
    let v0 = f32(params.uv.y) / f32(0xffffffffu);
    let u1 = f32(params.uv.z) / f32(0xffffffffu);
    let v1 = f32(params.uv.w) / f32(0xffffffffu);
    let u = mix(u0, u1, (f32(id.x) + 0.5) / f32(dest_width));
    let v = mix(v0, v1, (f32(id.y) + 0.5) / f32(dest_height));
    let sx = min(u32(clamp(u, 0.0, 0.999999) * f32(source_dims.x)), source_dims.x - 1u);
    let sy = min(u32(clamp(v, 0.0, 0.999999) * f32(source_dims.y)), source_dims.y - 1u);
    let source = color_to_byte(textureLoad(source_texture, vec2<i32>(i32(sx), i32(sy)), 0).rgb);
    let dest = color_to_byte(textureLoad(dest_snapshot_texture, vec2<i32>(i32(id.x), i32(id.y)), 0).rgb);
    let color = apply_draw_copy_rop(params.rop.x, source, dest);
    textureStore(
        target_texture,
        vec2<i32>(i32(params.dest.x + id.x), i32(params.dest.y + id.y)),
        vec4<f32>(byte_to_color(color), 1.0)
    );
}
"#;

const COMPUTE_BITMAP_BLIT_SHADER: &str = r#"
struct Params {
    dest: vec4<u32>,
    uv: vec4<u32>,
    rop: vec4<u32>,
};

@group(0) @binding(0)
var source_texture: texture_2d<f32>;
@group(0) @binding(1)
var dest_snapshot_texture: texture_2d<f32>;
@group(0) @binding(2)
var target_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3)
var<uniform> params: Params;

fn color_to_byte(color: vec3<f32>) -> vec3<u32> {
    return vec3<u32>(round(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)) * 255.0));
}

fn byte_to_color(color: vec3<u32>) -> vec3<f32> {
    return vec3<f32>(color) / 255.0;
}

fn apply_draw_copy_rop(rop: u32, source_input: vec3<u32>, dest_input: vec3<u32>) -> vec3<u32> {
    var source = source_input;
    var dest = dest_input;
    if ((rop & 1u) != 0u) {
        source = vec3<u32>(255u) - source;
    }
    if ((rop & 4u) != 0u) {
        dest = vec3<u32>(255u) - dest;
    }

    var result = source;
    if ((rop & 8u) != 0u) {
        result = source;
    } else if ((rop & 16u) != 0u) {
        result = source | dest;
    } else if ((rop & 32u) != 0u) {
        result = source & dest;
    } else if ((rop & 64u) != 0u) {
        result = source ^ dest;
    } else if ((rop & 128u) != 0u) {
        result = vec3<u32>(0u);
    } else if ((rop & 256u) != 0u) {
        result = vec3<u32>(255u);
    } else if ((rop & 512u) != 0u) {
        result = vec3<u32>(255u) - dest;
    }

    if ((rop & 1024u) != 0u) {
        result = vec3<u32>(255u) - result;
    }
    return result;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= params.dest.z || id.y >= params.dest.w) {
        return;
    }
    let source_dims = textureDimensions(source_texture);
    let dest_width = max(params.dest.z, 1u);
    let dest_height = max(params.dest.w, 1u);
    let u0 = f32(params.uv.x) / f32(0xffffffffu);
    let v0 = f32(params.uv.y) / f32(0xffffffffu);
    let u1 = f32(params.uv.z) / f32(0xffffffffu);
    let v1 = f32(params.uv.w) / f32(0xffffffffu);
    let u = mix(u0, u1, (f32(id.x) + 0.5) / f32(dest_width));
    let v = mix(v0, v1, (f32(id.y) + 0.5) / f32(dest_height));
    let sx = min(u32(clamp(u, 0.0, 0.999999) * f32(source_dims.x)), source_dims.x - 1u);
    let visual_sy = min(u32(clamp(v, 0.0, 0.999999) * f32(source_dims.y)), source_dims.y - 1u);
    var sy = visual_sy;
    if ((params.rop.y & 1u) == 0u) {
        sy = source_dims.y - 1u - visual_sy;
    }
    var source_sample = textureLoad(source_texture, vec2<i32>(i32(sx), i32(sy)), 0);
    if ((params.rop.y & 2u) == 0u) {
        source_sample.a = 1.0;
    }
    let source = color_to_byte(source_sample.rgb);
    let dest = color_to_byte(textureLoad(dest_snapshot_texture, vec2<i32>(i32(id.x), i32(id.y)), 0).rgb);
    let color = apply_draw_copy_rop(params.rop.x, source, dest);
    textureStore(
        target_texture,
        vec2<i32>(i32(params.dest.x + id.x), i32(params.dest.y + id.y)),
        vec4<f32>(byte_to_color(color), source_sample.a)
    );
}
"#;

const COMPUTE_BITMAP_UNPACK_SHADER: &str = r#"
struct BitmapUnpackItem {
    dest: vec4<u32>,
    uv: vec4<u32>,
    source: vec4<u32>,
    offset: vec4<u32>,
};

@group(0) @binding(0)
var<storage, read> source_pixels: array<u32>;
@group(0) @binding(1)
var<storage, read> items: array<BitmapUnpackItem>;
@group(0) @binding(2)
var target_texture: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let item = items[id.z];
    if (id.x >= item.dest.z || id.y >= item.dest.w) {
        return;
    }
    let source_width = item.source.x;
    let source_height = item.source.y;
    let stride_words = item.source.z;
    let flags = item.source.w;
    let source_offset_words = item.offset.x;
    let dest_width = max(item.dest.z, 1u);
    let dest_height = max(item.dest.w, 1u);
    let u0 = f32(item.uv.x) / f32(0xffffffffu);
    let v0 = f32(item.uv.y) / f32(0xffffffffu);
    let u1 = f32(item.uv.z) / f32(0xffffffffu);
    let v1 = f32(item.uv.w) / f32(0xffffffffu);
    let u = mix(u0, u1, (f32(id.x) + 0.5) / f32(dest_width));
    let v = mix(v0, v1, (f32(id.y) + 0.5) / f32(dest_height));
    let src_x = min(u32(clamp(u, 0.0, 0.999999) * f32(source_width)), source_width - 1u);
    let logical_y = min(u32(clamp(v, 0.0, 0.999999) * f32(source_height)), source_height - 1u);
    if (src_x >= source_width || logical_y >= source_height) {
        return;
    }
    var src_y = logical_y;
    if ((flags & 1u) == 0u) {
        src_y = source_height - 1u - logical_y;
    }
    let pixel = source_pixels[source_offset_words + src_y * stride_words + src_x];
    var red = f32((pixel >> 16u) & 0xffu) / 255.0;
    let green = f32((pixel >> 8u) & 0xffu) / 255.0;
    var blue = f32(pixel & 0xffu) / 255.0;
    var alpha = 1.0;
    if ((flags & 2u) != 0u) {
        alpha = f32((pixel >> 24u) & 0xffu) / 255.0;
    }
    textureStore(
        target_texture,
        vec2<i32>(i32(item.dest.x + id.x), i32(item.dest.y + id.y)),
        vec4<f32>(red, green, blue, alpha)
    );
}
"#;
