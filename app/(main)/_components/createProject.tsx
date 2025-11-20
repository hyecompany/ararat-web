"use client";

// Component for creating new Incus projects
import { Button } from "@/app/_components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/_components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/app/_components/ui/form";
import { Input } from "@/app/_components/ui/input";
import { useState, use } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";
import { createProject } from "@/app/(main)/_lib/projects";
import { mutate } from "swr";
import { toast } from "sonner";
import { Textarea } from "@/app/_components/textarea";
import { useConfigurableOptions } from "@/app/_hooks/server";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/app/_components/ui/accordion";
import ProjectsContext from "@/app/(main)/_context/projects";
import { Checkbox } from "@/app/_components/ui/checkbox";

const formSchema = z.object({
  name: z
    .string()
    .min(1, "Project name is required")
    .max(63, "Project name must be at most 63 characters long")
    .regex(
      /^[a-z][a-z0-9-]*[a-z0-9]$/,
      "Project name must start with a lowercase letter and can only contain lowercase letters, numbers, and dashes. It cannot end with a dash."
    ),
  description: z.string().optional(),
  config: z.record(z.string()).optional(),
});

interface ProjectConfigField {
  key: string;
  type?: string;
  shortdesc?: string;
  longdesc?: string;
  defaultdesc?: string;
  initialvaluedesc?: string;
}

interface ConfigCategory {
  keys: Array<Record<string, ProjectConfigField>>;
}

interface ProjectConfigOptions {
  [category: string]: ConfigCategory;
}

interface CreateProjectProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CreateProject({ open, onOpenChange }: CreateProjectProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { data: configurableOptions } = useConfigurableOptions();
  const { setProject } = use(ProjectsContext);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      config: {},
    },
  });

  // Parse project configuration options from metadata
  const projectConfigOptions: Array<{ category: string; fields: Array<{ name: string; field: ProjectConfigField }> }> = [];
  
  if (configurableOptions?.configs?.project) {
    const projectConfig = configurableOptions.configs.project as ProjectConfigOptions;
    
    Object.entries(projectConfig).forEach(([category, categoryData]) => {
      if (categoryData.keys && Array.isArray(categoryData.keys)) {
        const fields = categoryData.keys.map((keyObj) => {
          const [name, field] = Object.entries(keyObj)[0];
          return { name, field };
        });
        projectConfigOptions.push({ category, fields });
      }
    });
  }

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      setIsSubmitting(true);

      // Filter out empty config values
      const config = Object.entries(values.config || {}).reduce(
        (acc, [key, value]) => {
          if (value && value.trim() !== "") {
            acc[key] = value;
          }
          return acc;
        },
        {} as Record<string, string>
      );

      await createProject({
        name: values.name,
        description: values.description,
        config: Object.keys(config).length > 0 ? config : undefined,
      });

      // Invalidate the projects cache to refresh the list
      await mutate("/1.0/projects?recursion=1");

      // Set the newly created project as the current project
      setProject(values.name);

      onOpenChange(false);
      form.reset();
    } catch (error) {
      console.error("Failed to create project:", error);
      toast.error("Failed to create project", {
        description:
          error instanceof Error ? error.message : "An unknown error occurred",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderConfigField = (
    name: string,
    field: ProjectConfigField,
    formField: {
      value: string;
      onChange: (value: string) => void;
      onBlur: () => void;
      name: string;
      ref: React.Ref<HTMLInputElement>;
    }
  ) => {
    const defaultDesc = field.defaultdesc || field.initialvaluedesc || "";
    
    if (field.type === "bool") {
      return (
        <div className="flex items-center space-x-2">
          <Checkbox
            id={name}
            checked={formField.value === "true"}
            onCheckedChange={(checked) => {
              formField.onChange(checked ? "true" : "false");
            }}
            disabled={isSubmitting}
          />
          <label
            htmlFor={name}
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            {name}
          </label>
        </div>
      );
    } else if (field.type === "integer") {
      return (
        <Input
          type="number"
          placeholder={defaultDesc}
          {...formField}
          disabled={isSubmitting}
        />
      );
    } else {
      return (
        <Input
          placeholder={defaultDesc}
          {...formField}
          disabled={isSubmitting}
        />
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
          <DialogDescription>
            Create a new project with optional configuration
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="my-project"
                      {...field}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormDescription>
                    The name must start with a lowercase letter and contain only
                    lowercase letters, numbers, and dashes.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Project description"
                      {...field}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {projectConfigOptions.length > 0 && (
              <Accordion type="multiple" className="w-full">
                {projectConfigOptions.map(({ category, fields }) => (
                  <AccordionItem key={category} value={category}>
                    <AccordionTrigger className="capitalize">
                      {category}
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-4 pt-4">
                        {fields.map(({ name, field }) => (
                          <FormField
                            key={name}
                            control={form.control}
                            name={`config.${name}`}
                            render={({ field: formField }) => (
                              <FormItem>
                                {field.type !== "bool" && (
                                  <FormLabel className="text-xs">
                                    {name}
                                  </FormLabel>
                                )}
                                <FormControl>
                                  {renderConfigField(name, field, formField)}
                                </FormControl>
                                {(field.longdesc || field.shortdesc) && (
                                  <FormDescription className="text-xs">
                                    {field.shortdesc}
                                  </FormDescription>
                                )}
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create Project"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
